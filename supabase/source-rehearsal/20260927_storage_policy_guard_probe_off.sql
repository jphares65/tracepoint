-- Exact inverse of the paid-only Storage RLS function guard probe.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres'
    OR (SELECT count(*) FROM public.departments WHERE id =
      'acb5b501-2309-4a9e-a504-f36c08728fa9'
      AND slug = 'tracepoint-source-rehearsal-20260925') <> 1
    OR (SELECT count(*) FROM public.departments) <> 1
    OR (SELECT count(*) FROM tracepoint_cutover.write_fence_state
      WHERE id=1 AND frozen=false) <> 1
    OR (SELECT count(*) FROM tracepoint_cutover.storage_policy_guard_probe
      WHERE id=1 AND active=true AND original_md5=
        '11f7fb50c985589515faa758fb30b058') <> 1
    OR position('storage_policy_guard_probe' IN pg_get_functiondef(
      'public.has_department_permission(uuid,text)'::regprocedure)) = 0
  THEN RAISE EXCEPTION 'PAID_STORAGE_GUARD_PROBE_OFF_GUARD_FAILED';
  END IF;
END $guard$;
DO $restore$
BEGIN
  EXECUTE (SELECT original_definition
    FROM tracepoint_cutover.storage_policy_guard_probe WHERE id=1);
END $restore$;
DROP TABLE tracepoint_cutover.storage_policy_guard_probe;
DO $verify$
BEGIN
  IF md5(pg_get_functiondef('public.has_department_permission(uuid,text)'::regprocedure))
      <> '11f7fb50c985589515faa758fb30b058'
    OR to_regclass('tracepoint_cutover.storage_policy_guard_probe') IS NOT NULL
    OR (SELECT count(*) FROM tracepoint_cutover.write_fence_state
      WHERE id=1 AND frozen=false) <> 1
  THEN RAISE EXCEPTION 'PAID_STORAGE_GUARD_PROBE_OFF_VERIFY_FAILED';
  END IF;
END $verify$;
COMMIT;
SELECT md5(pg_get_functiondef('public.has_department_permission(uuid,text)'::regprocedure)) AS restored_md5,
  (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id=1) AS frozen;
