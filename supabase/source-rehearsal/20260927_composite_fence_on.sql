-- Paid Supabase source rehearsal ONLY: reukdouvpshshvqnzsgw.
-- Run in that project's SQL Editor after visually attesting the project URL.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres'
    OR (SELECT count(*) FROM public.departments
        WHERE id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
          AND slug = 'tracepoint-source-rehearsal-20260925') <> 1
    OR (SELECT count(*) FROM public.departments) <> 1
    OR (SELECT count(*) FROM tracepoint_cutover.write_fence_state
        WHERE id = 1 AND frozen = false) <> 1
    OR (SELECT count(*) FROM pg_trigger
        WHERE tgname LIKE 'tracepoint%fence%' AND NOT tgisinternal) <> 248
    OR md5(pg_get_functiondef('tracepoint_cutover.reject_when_frozen()'::regprocedure))
        <> '53045ace60d3a55a673066017d814b38'
    OR (SELECT count(*) FROM cron.job WHERE active) <> 0
  THEN RAISE EXCEPTION 'PAID_REHEARSAL_FENCE_ON_GUARD_FAILED';
  END IF;
END $guard$;
UPDATE tracepoint_cutover.write_fence_state
SET frozen = true, changed_at = clock_timestamp(),
    changed_by = 'paid-source-composite-rehearsal-20260927-on'
WHERE id = 1 AND frozen = false;
DO $verify$
BEGIN
  IF (SELECT count(*) FROM tracepoint_cutover.write_fence_state
      WHERE id = 1 AND frozen = true
        AND changed_by = 'paid-source-composite-rehearsal-20260927-on') <> 1
  THEN RAISE EXCEPTION 'PAID_REHEARSAL_FENCE_ON_VERIFY_FAILED';
  END IF;
END $verify$;
COMMIT;
SELECT frozen, changed_at, changed_by FROM tracepoint_cutover.write_fence_state WHERE id = 1;
