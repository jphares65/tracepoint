-- PAID SOURCE REHEARSAL ONLY. Run only after the pinned AWS-only synthetic
-- fleet write and its audit event have both committed on the source-proof RDS.
-- The fence is OFF only inside this transaction; other sessions never observe it.
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'SOURCE_DATABASE_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM tracepoint_cutover.write_fence_state WHERE id = 1 AND frozen = true) <> 1 THEN
    RAISE EXCEPTION 'SOURCE_FENCE_NOT_ACTIVE';
  END IF;
  IF (SELECT count(*) FROM public.departments
      WHERE id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
        AND slug = 'tracepoint-source-rehearsal-20260925') <> 1 THEN
    RAISE EXCEPTION 'SYNTHETIC_SOURCE_TENANT_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id = '3698d462-6367-4a3b-98ba-27d9279fe457') <> 1
     OR (SELECT count(*) FROM public.profiles WHERE id = '3698d462-6367-4a3b-98ba-27d9279fe457') <> 1
     OR (SELECT count(*) FROM public.department_memberships
         WHERE department_id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
           AND user_id = '3698d462-6367-4a3b-98ba-27d9279fe457'
           AND is_active = true) <> 1 THEN
    RAISE EXCEPTION 'SYNTHETIC_SOURCE_IDENTITY_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fleet_vehicles
      WHERE id = '4fe22291-4da8-4e98-acbe-e12be4a943ad'
         OR (department_id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
             AND unit_number = 'TP-AUTH-ROLLBACK-20260925'))
     OR EXISTS (SELECT 1 FROM public.audit_events
         WHERE department_id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
           AND entity_type = 'fleet_vehicles'
           AND entity_id = '4fe22291-4da8-4e98-acbe-e12be4a943ad') THEN
    RAISE EXCEPTION 'SOURCE_ROLLBACK_MARKER_ALREADY_PRESENT';
  END IF;
END;
$preflight$;

UPDATE tracepoint_cutover.write_fence_state
SET frozen = false, changed_at = now(), changed_by = 'synthetic-authority-rollback-replay'
WHERE id = 1 AND frozen = true;

INSERT INTO public.fleet_vehicles
  (id, department_id, unit_number, status, assignment_type, current_mileage, current_hours,
   open_issue_count, created_by_user_id, updated_by_user_id, created_at, updated_at, retired_at)
VALUES
  ('4fe22291-4da8-4e98-acbe-e12be4a943ad',
   'acb5b501-2309-4a9e-a504-f36c08728fa9',
   'TP-AUTH-ROLLBACK-20260925', 'Retired', 'Pool', 0, 0, 0,
   '3698d462-6367-4a3b-98ba-27d9279fe457',
   '3698d462-6367-4a3b-98ba-27d9279fe457',
   '2026-09-26T00:55:00.000Z', '2026-09-26T00:55:00.000Z', '2026-09-26T00:55:00.000Z');

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.fleet_vehicles
      WHERE id = '4fe22291-4da8-4e98-acbe-e12be4a943ad'
        AND department_id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
        AND unit_number = 'TP-AUTH-ROLLBACK-20260925'
        AND status = 'Retired'
        AND created_by_user_id = '3698d462-6367-4a3b-98ba-27d9279fe457') <> 1 THEN
    RAISE EXCEPTION 'SOURCE_ROLLBACK_WRITE_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM public.audit_events
      WHERE department_id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
        AND entity_type = 'fleet_vehicles'
        AND entity_id = '4fe22291-4da8-4e98-acbe-e12be4a943ad'
        AND action = 'insert'
        AND actor_user_id = '3698d462-6367-4a3b-98ba-27d9279fe457'
        AND details->>'source' = 'database_trigger') <> 1 THEN
    RAISE EXCEPTION 'SOURCE_ROLLBACK_AUDIT_MISMATCH';
  END IF;
END;
$verify$;

UPDATE tracepoint_cutover.write_fence_state
SET frozen = true, changed_at = now(), changed_by = 'synthetic-authority-rollback-replay'
WHERE id = 1 AND frozen = false;

DO $final$
BEGIN
  IF (SELECT count(*) FROM tracepoint_cutover.write_fence_state WHERE id = 1 AND frozen = true) <> 1 THEN
    RAISE EXCEPTION 'SOURCE_FENCE_RESTORE_FAILED';
  END IF;
END;
$final$;
COMMIT;

SELECT 'SOURCE_SYNTHETIC_REPLAY_PASS' AS status,
  (SELECT count(*) FROM public.fleet_vehicles
   WHERE id = '4fe22291-4da8-4e98-acbe-e12be4a943ad') AS vehicle_rows,
  (SELECT count(*) FROM public.audit_events
   WHERE department_id = 'acb5b501-2309-4a9e-a504-f36c08728fa9'
     AND entity_type = 'fleet_vehicles'
     AND entity_id = '4fe22291-4da8-4e98-acbe-e12be4a943ad') AS audit_rows,
  (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id = 1) AS fence_restored;
