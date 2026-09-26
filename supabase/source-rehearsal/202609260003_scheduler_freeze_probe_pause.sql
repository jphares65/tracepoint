-- Paid source rehearsal only. Pause exactly the harmless scheduler fixture.
BEGIN;
DO $preflight$
BEGIN
  IF current_database() <> 'postgres'
    OR (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id = 1) IS DISTINCT FROM true
    OR (SELECT count(*) FROM public.departments) <> 1
    OR (SELECT count(*) FROM public.departments WHERE id = 'acb5b501-2309-4a9e-a504-f36c08728fa9') <> 1
    OR (SELECT count(*) FROM cron.job WHERE jobname = 'tracepoint-source-rehearsal-freeze-probe'
        AND active AND command = 'SELECT 1') <> 1
  THEN
    RAISE EXCEPTION 'SOURCE_REHEARSAL_SCHEDULER_PAUSE_PREFLIGHT_FAILED';
  END IF;
END;
$preflight$;
SELECT cron.alter_job(jobid, active := false)
FROM cron.job
WHERE jobname = 'tracepoint-source-rehearsal-freeze-probe' AND active AND command = 'SELECT 1';
DO $postflight$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'tracepoint-source-rehearsal-freeze-probe'
      AND NOT active AND command = 'SELECT 1') <> 1
    OR EXISTS (SELECT 1 FROM cron.job_run_details r JOIN cron.job j USING (jobid)
               WHERE j.jobname = 'tracepoint-source-rehearsal-freeze-probe' AND r.status = 'running')
  THEN
    RAISE EXCEPTION 'SOURCE_REHEARSAL_SCHEDULER_PAUSE_FAILED';
  END IF;
END;
$postflight$;
COMMIT;
SELECT 'SCHEDULER_FIXTURE_PAUSED' AS status;
