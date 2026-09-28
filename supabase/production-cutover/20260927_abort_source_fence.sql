-- PRE-AUTHORITY ABORT ONLY. Requires external proof of zero AWS-only writes,
-- bridge ownership, exact project identity, and maintenance still active.
-- Never execute as a post-authority rollback shortcut.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $guard$
DECLARE actual_digest text;
BEGIN
  IF current_database() <> 'postgres' OR current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'PRODUCTION_SOURCE_ROLE_OR_DATABASE_MISMATCH';
  END IF;
  SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text,
    E'\n' ORDER BY n.nspname,c.relname)) INTO actual_digest
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p');
  IF actual_digest <> '36558b0730e3e96cad6426f38088a5b0'
     OR (SELECT count(*) FROM tracepoint_cutover.write_fence_state WHERE id=1 AND frozen) <> 1
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
        AND n.nspname='public'
        AND t.tgname IN ('tracepoint_write_fence_dml','tracepoint_write_fence_truncate')
        AND t.tgenabled='A') <> 174
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='tracepoint_cutover' AND c.relkind='r'
         AND c.relrowsecurity) <> 3
     OR (SELECT count(*) FROM tracepoint_cutover.storage_permission_function_backup
       WHERE id=1 AND original_md5='5537f428cb4f1fac15320843cb213faa') <> 1
     OR position('tracepoint_cutover.write_fence_state' IN pg_get_functiondef(
       'public.has_department_permission(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'PRODUCTION_SOURCE_FENCE_STATE_DRIFT';
  END IF;
  IF (SELECT count(*) FROM cron.job j JOIN tracepoint_cutover.dispatcher_snapshot s
        ON s.jobid=j.jobid WHERE s.id=1
        AND j.jobname='tracepoint-notification-email-dispatch'
        AND NOT j.active AND j.schedule=s.schedule AND md5(j.command)=s.command_md5) <> 1 THEN
    RAISE EXCEPTION 'PRODUCTION_DISPATCHER_RESTORE_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job_run_details r JOIN cron.job j USING(jobid)
      WHERE j.jobname='tracepoint-notification-email-dispatch' AND r.status='running') THEN
    RAISE EXCEPTION 'PRODUCTION_DISPATCHER_STILL_RUNNING';
  END IF;
END $guard$;

DO $remove$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS schema_name,c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY n.nspname,c.relname
  LOOP
    EXECUTE format('DROP TRIGGER tracepoint_write_fence_dml ON %I.%I',r.schema_name,r.table_name);
    EXECUTE format('DROP TRIGGER tracepoint_write_fence_truncate ON %I.%I',r.schema_name,r.table_name);
  END LOOP;
END $remove$;

SELECT cron.alter_job(j.jobid, active := true)
  FROM cron.job j JOIN tracepoint_cutover.dispatcher_snapshot s ON s.jobid=j.jobid
  WHERE s.id=1 AND j.jobname='tracepoint-notification-email-dispatch';
DO $restore_storage_permission$
BEGIN
  EXECUTE (SELECT original_definition
    FROM tracepoint_cutover.storage_permission_function_backup WHERE id=1);
END $restore_storage_permission$;
DROP TABLE tracepoint_cutover.storage_permission_function_backup;
DROP FUNCTION public.tracepoint_source_production_fence_status();
DROP FUNCTION tracepoint_cutover.reject_source_dml();
DROP TABLE tracepoint_cutover.dispatcher_snapshot;
DROP TABLE tracepoint_cutover.write_fence_state;
DROP SCHEMA tracepoint_cutover;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname='tracepoint-notification-email-dispatch'
      AND active) <> 1
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
       AND tgname IN ('tracepoint_write_fence_dml','tracepoint_write_fence_truncate'))
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='tracepoint_cutover')
     OR md5(pg_get_functiondef('public.has_department_permission(uuid,text)'::regprocedure))
       <> '5537f428cb4f1fac15320843cb213faa' THEN
    RAISE EXCEPTION 'PRODUCTION_SOURCE_ABORT_INCOMPLETE';
  END IF;
END $verify$;
COMMIT;

-- Verify source write continuity and public bridge health, then reverse the
-- reviewed maintenance-response stack. Never unfreeze with AWS authority active.
