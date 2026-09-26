-- Paid source rehearsal only. Remove exactly the harmless scheduler fixture.
BEGIN;
DO $preflight$
BEGIN
  IF current_database() <> 'postgres'
    OR (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id = 1) IS DISTINCT FROM true
    OR (SELECT count(*) FROM public.departments) <> 1
    OR (SELECT count(*) FROM public.departments WHERE id = 'acb5b501-2309-4a9e-a504-f36c08728fa9') <> 1
    OR (SELECT count(*) FROM cron.job WHERE jobname = 'tracepoint-source-rehearsal-freeze-probe'
        AND NOT active AND command = 'SELECT 1') <> 1
  THEN
    RAISE EXCEPTION 'SOURCE_REHEARSAL_SCHEDULER_REMOVE_PREFLIGHT_FAILED';
  END IF;
END;
$preflight$;
SELECT cron.unschedule('tracepoint-source-rehearsal-freeze-probe');
DO $postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tracepoint-source-rehearsal-freeze-probe')
  THEN
    RAISE EXCEPTION 'SOURCE_REHEARSAL_SCHEDULER_REMOVE_FAILED';
  END IF;
END;
$postflight$;
COMMIT;
SELECT 'SCHEDULER_FIXTURE_REMOVED' AS status;
