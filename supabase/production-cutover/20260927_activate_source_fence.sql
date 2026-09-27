-- CUTOVER EXECUTION ONLY. Never run as a preparation or rehearsal command.
-- Submit only through the SQL Editor for project izlkwggluhlhzlumtzes after
-- the external project-identity preflight and public maintenance 503 pass.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $guard$
DECLARE
  actual_count integer;
  actual_digest text;
BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'PRODUCTION_SOURCE_ROLE_OR_DATABASE_MISMATCH';
  END IF;
  SELECT count(*), md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text,
      E'\n' ORDER BY n.nspname, c.relname))
    INTO actual_count, actual_digest
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth', 'storage') AND c.relkind IN ('r', 'p');
  IF actual_count <> 122 OR actual_digest <> '36558b0730e3e96cad6426f38088a5b0' THEN
    RAISE EXCEPTION 'PRODUCTION_SOURCE_RELATION_CONTRACT_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'tracepoint_cutover')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='tracepoint_source_production_fence_status')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
        AND tgname IN ('tracepoint_write_fence_dml','tracepoint_write_fence_truncate')) THEN
    RAISE EXCEPTION 'PRODUCTION_SOURCE_FENCE_ALREADY_PRESENT';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='tracepoint-notification-email-dispatch'
        AND active AND schedule='*/15 * * * *'
        AND command LIKE '%net.http_post%'
        AND command LIKE '%tracepoint-amber.vercel.app%') <> 1 THEN
    RAISE EXCEPTION 'PRODUCTION_DISPATCHER_CONTRACT_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job_run_details r JOIN cron.job j USING (jobid)
      WHERE j.jobname='tracepoint-notification-email-dispatch' AND r.status='running') THEN
    RAISE EXCEPTION 'PRODUCTION_DISPATCHER_STILL_RUNNING';
  END IF;
END $guard$;

CREATE SCHEMA tracepoint_cutover;
REVOKE ALL ON SCHEMA tracepoint_cutover FROM PUBLIC;
CREATE TABLE tracepoint_cutover.write_fence_state (
  id integer PRIMARY KEY CHECK (id = 1),
  frozen boolean NOT NULL,
  changed_at timestamptz NOT NULL
);
REVOKE ALL ON tracepoint_cutover.write_fence_state FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE tracepoint_cutover.dispatcher_snapshot (
  id integer PRIMARY KEY CHECK (id = 1),
  jobid bigint NOT NULL UNIQUE,
  schedule text NOT NULL,
  command_md5 text NOT NULL,
  prior_active boolean NOT NULL CHECK (prior_active),
  captured_at timestamptz NOT NULL
);
REVOKE ALL ON tracepoint_cutover.dispatcher_snapshot FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO tracepoint_cutover.dispatcher_snapshot
  SELECT 1, jobid, schedule, md5(command), active, clock_timestamp()
  FROM cron.job WHERE jobname='tracepoint-notification-email-dispatch';

CREATE FUNCTION tracepoint_cutover.reject_source_dml() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, tracepoint_cutover AS $fn$
BEGIN
  IF (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id=1) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TRACEPOINT_SOURCE_FROZEN' USING ERRCODE='55000';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION tracepoint_cutover.reject_source_dml() FROM PUBLIC;

CREATE FUNCTION public.tracepoint_source_production_fence_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, tracepoint_cutover AS $fn$
  SELECT jsonb_build_object(
    'frozen', (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id=1),
    'database', current_database(),
    'changed_at', (SELECT changed_at FROM tracepoint_cutover.write_fence_state WHERE id=1),
    'relation_count', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')),
    'trigger_count', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
      AND n.nspname IN ('public','auth','storage')
      AND t.tgname IN ('tracepoint_write_fence_dml','tracepoint_write_fence_truncate')
      AND t.tgenabled='A'));
$fn$;
REVOKE ALL ON FUNCTION public.tracepoint_source_production_fence_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracepoint_source_production_fence_status() TO service_role;

DO $install$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')
    ORDER BY n.nspname,c.relname
  LOOP
    EXECUTE format('CREATE TRIGGER tracepoint_write_fence_dml BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION tracepoint_cutover.reject_source_dml()',r.schema_name,r.table_name);
    EXECUTE format('CREATE TRIGGER tracepoint_write_fence_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION tracepoint_cutover.reject_source_dml()',r.schema_name,r.table_name);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER tracepoint_write_fence_dml',r.schema_name,r.table_name);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER tracepoint_write_fence_truncate',r.schema_name,r.table_name);
  END LOOP;
END $install$;

SELECT cron.alter_job(jobid, active := false)
  FROM cron.job WHERE jobname='tracepoint-notification-email-dispatch';
INSERT INTO tracepoint_cutover.write_fence_state VALUES (1, true, clock_timestamp());

DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
      AND n.nspname IN ('public','auth','storage')
      AND t.tgname IN ('tracepoint_write_fence_dml','tracepoint_write_fence_truncate')
      AND t.tgenabled='A') <> 244
     OR (SELECT count(*) FROM cron.job WHERE jobname='tracepoint-notification-email-dispatch'
         AND NOT active) <> 1
     OR (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id=1) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PRODUCTION_SOURCE_FENCE_INSTALL_INCOMPLETE';
  END IF;
END $verify$;
COMMIT;

-- External post-commit writer-family negatives and stable status RPC are mandatory
-- before capture. Any failure invokes the reviewed pre-authority abort procedure.
