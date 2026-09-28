-- Isolated paid source rehearsal ONLY: reukdouvpshshvqnzsgw.
-- The fence is never committed off. Other transactions see frozen=true
-- throughout; this transaction alone may drain Supabase-managed sessions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres'
    OR (SELECT count(*) FROM public.departments
        WHERE id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
          AND slug = 'tracepoint-source-rehearsal-20260925') <> 1
    OR (SELECT count(*) FROM public.departments) <> 1
    OR (SELECT count(*) FROM auth.users
        WHERE id = '3698d462-6367-4a3b-98ba-27d9279fe457'
          AND email = 'tracepoint-source-rehearsal-20260925@example.invalid') <> 1
    OR (SELECT count(*) FROM auth.users) <> 1
    OR (SELECT count(*) FROM auth.sessions
        WHERE user_id <> '3698d462-6367-4a3b-98ba-27d9279fe457') <> 0
    OR (SELECT count(*) FROM auth.sessions) > 100
    OR (SELECT count(*) FROM auth.refresh_tokens) > 100
    OR (SELECT count(*) FROM tracepoint_cutover.write_fence_state
        WHERE id = 1 AND frozen = true) <> 1
    OR (SELECT count(*) FROM pg_trigger
        WHERE tgname LIKE 'tracepoint%fence%' AND NOT tgisinternal) <> 248
    OR md5(pg_get_functiondef('tracepoint_cutover.reject_when_frozen()'::regprocedure))
        <> '53045ace60d3a55a673066017d814b38'
    OR (SELECT count(*) FROM cron.job WHERE active) <> 0
  THEN RAISE EXCEPTION 'PAID_EPOCH_SESSION_DRAIN_GUARD_FAILED';
  END IF;
END $guard$;

-- The state row lock serializes operator transitions. Its false value is
-- uncommitted and invisible to concurrent clients, which continue to see
-- true and remain blocked by the statement-level fence triggers.
SELECT id FROM tracepoint_cutover.write_fence_state WHERE id = 1 FOR UPDATE;
UPDATE tracepoint_cutover.write_fence_state SET frozen = false WHERE id = 1 AND frozen = true;
DO $drain$
DECLARE
  sessions_before bigint;
  refresh_before bigint;
  sessions_deleted bigint;
BEGIN
  SELECT count(*) INTO sessions_before FROM auth.sessions;
  SELECT count(*) INTO refresh_before FROM auth.refresh_tokens;
  DELETE FROM auth.sessions;
  GET DIAGNOSTICS sessions_deleted = ROW_COUNT;
  DELETE FROM auth.refresh_tokens;
  IF sessions_deleted <> sessions_before
    OR (SELECT count(*) FROM auth.sessions) <> 0
    OR (SELECT count(*) FROM auth.refresh_tokens) <> 0
    OR (SELECT count(*) FROM auth.users) <> 1
  THEN RAISE EXCEPTION 'PAID_EPOCH_SESSION_DRAIN_INCOMPLETE';
  END IF;
  RAISE NOTICE 'PAID_EPOCH_SESSION_DRAIN sessions_before=% sessions_deleted=% refresh_before=%',
    sessions_before, sessions_deleted, refresh_before;
END $drain$;
UPDATE tracepoint_cutover.write_fence_state SET frozen = true WHERE id = 1 AND frozen = false;
DO $verify$
BEGIN
  IF (SELECT count(*) FROM tracepoint_cutover.write_fence_state
      WHERE id = 1 AND frozen = true) <> 1
    OR (SELECT count(*) FROM auth.sessions) <> 0
    OR (SELECT count(*) FROM auth.refresh_tokens) <> 0
  THEN RAISE EXCEPTION 'PAID_EPOCH_SESSION_DRAIN_VERIFY_FAILED';
  END IF;
END $verify$;
COMMIT;
SELECT frozen,
  (SELECT count(*) FROM auth.sessions) AS sessions_remaining,
  (SELECT count(*) FROM auth.refresh_tokens) AS refresh_remaining,
  (SELECT count(*) FROM auth.users) AS users_remaining
FROM tracepoint_cutover.write_fence_state WHERE id = 1;
