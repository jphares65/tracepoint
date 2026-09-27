-- CUTOVER EXECUTION ONLY: live project izlkwggluhlhzlumtzes.
-- Run only after reviewed maintenance, public-table fence, Email sign-in
-- disablement, and every autonomous service/Admin Auth writer is paused.
-- This revokes sessions, not users, passwords, MFA factors, or memberships.
-- Existing sessions cannot be restored; pre-authority abort restores normal
-- sign-in and users authenticate again. Never use this as a standalone fence.
-- The SQL Editor project identity must be attested externally before running.
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
  IF (SELECT count(*) FROM tracepoint_cutover.write_fence_state WHERE id = 1 AND frozen) <> 1
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE NOT t.tgisinternal AND n.nspname = 'public'
            AND t.tgname IN ('tracepoint_write_fence_dml', 'tracepoint_write_fence_truncate')
            AND t.tgenabled = 'A') <> 174
     OR (SELECT count(*) FROM cron.job
          WHERE jobname = 'tracepoint-notification-email-dispatch' AND NOT active) <> 1 THEN
    RAISE EXCEPTION 'PRODUCTION_COMPOSITE_FENCE_NOT_ACTIVE';
  END IF;
  IF NOT has_table_privilege(current_user, 'auth.sessions', 'DELETE')
     OR NOT has_table_privilege(current_user, 'auth.refresh_tokens', 'DELETE') THEN
    RAISE EXCEPTION 'PRODUCTION_AUTH_SESSION_DRAIN_PERMISSION_MISSING';
  END IF;
END $guard$;

-- Auth's supported global sign-out deletes sessions; the paid-project probe
-- confirmed the same table-level action rejects old refresh and Auth user
-- writes. Old JWTs may still work for PostgREST/Storage, whose independent
-- public-table trigger and Storage permission-function controls remain on.
DO $drain$
DECLARE
  sessions_before bigint;
  refresh_before bigint;
  sessions_deleted bigint;
  refresh_deleted bigint;
BEGIN
  SELECT count(*) INTO sessions_before FROM auth.sessions;
  SELECT count(*) INTO refresh_before FROM auth.refresh_tokens;
  DELETE FROM auth.sessions;
  GET DIAGNOSTICS sessions_deleted = ROW_COUNT;
  DELETE FROM auth.refresh_tokens;
  GET DIAGNOSTICS refresh_deleted = ROW_COUNT;
  IF sessions_deleted <> sessions_before
     OR (SELECT count(*) FROM auth.sessions) <> 0
     OR (SELECT count(*) FROM auth.refresh_tokens) <> 0 THEN
    RAISE EXCEPTION 'PRODUCTION_AUTH_SESSION_DRAIN_INCOMPLETE';
  END IF;
  RAISE NOTICE 'AUTH_SESSION_DRAIN_COUNTS sessions_before=% sessions_deleted=% refresh_before=% refresh_remaining=%',
    sessions_before, sessions_deleted, refresh_before,
    (SELECT count(*) FROM auth.refresh_tokens);
END $drain$;
COMMIT;

-- After commit, verify zero sessions and refresh tokens through the trusted
-- operator connection, then perform real-interface negatives and A/B capture.
-- If any writer creates a new session, abort before capture; do not improvise
-- a repeat drain while the source is still accepting autonomous writes.
