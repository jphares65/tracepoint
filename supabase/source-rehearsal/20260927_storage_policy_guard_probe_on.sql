-- Paid project reukdouvpshshvqnzsgw ONLY. Test Storage RLS function gating
-- with the existing Auth/Storage trigger fence INACTIVE (frozen=false).
-- This transaction does not change any Supabase-managed schema object.
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
    OR md5(pg_get_functiondef('public.has_department_permission(uuid,text)'::regprocedure))
      <> '11f7fb50c985589515faa758fb30b058'
    OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid =
      'public.has_department_permission(uuid,text)'::regprocedure)) <> 'postgres'
    OR to_regclass('tracepoint_cutover.storage_policy_guard_probe') IS NOT NULL
  THEN RAISE EXCEPTION 'PAID_STORAGE_GUARD_PROBE_ON_GUARD_FAILED';
  END IF;
END $guard$;

CREATE TABLE tracepoint_cutover.storage_policy_guard_probe (
  id integer PRIMARY KEY CHECK (id=1),
  active boolean NOT NULL CHECK (active),
  original_definition text NOT NULL,
  original_md5 text NOT NULL
);
ALTER TABLE tracepoint_cutover.storage_policy_guard_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tracepoint_cutover.storage_policy_guard_probe
  FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO tracepoint_cutover.storage_policy_guard_probe
SELECT 1, true,
  pg_get_functiondef('public.has_department_permission(uuid,text)'::regprocedure),
  md5(pg_get_functiondef('public.has_department_permission(uuid,text)'::regprocedure));

CREATE OR REPLACE FUNCTION public.has_department_permission(
  p_department_id uuid, p_permission_code text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.department_memberships membership
    JOIN public.department_membership_roles membership_role
      ON membership_role.department_id = membership.department_id
     AND membership_role.user_id = membership.user_id
    WHERE membership.department_id = p_department_id
      AND membership.user_id = auth.uid()
      AND membership.is_active = true
      AND NOT (SELECT active FROM tracepoint_cutover.storage_policy_guard_probe WHERE id=1)
      AND EXISTS (SELECT 1 FROM public.permissions permission
        WHERE permission.code = p_permission_code)
      AND (membership_role.role_code = 'administrator' OR EXISTS (
        SELECT 1 FROM public.department_role_permissions role_permission
        WHERE role_permission.department_id = membership_role.department_id
          AND role_permission.role_code = membership_role.role_code
          AND role_permission.permission_code = p_permission_code
      ))
  );
$function$;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM tracepoint_cutover.storage_policy_guard_probe
      WHERE id=1 AND active=true AND original_md5=
        '11f7fb50c985589515faa758fb30b058') <> 1
    OR position('storage_policy_guard_probe' IN pg_get_functiondef(
      'public.has_department_permission(uuid,text)'::regprocedure)) = 0
    OR (SELECT count(*) FROM tracepoint_cutover.write_fence_state
      WHERE id=1 AND frozen=false) <> 1
  THEN RAISE EXCEPTION 'PAID_STORAGE_GUARD_PROBE_ON_VERIFY_FAILED';
  END IF;
END $verify$;
COMMIT;
SELECT (SELECT frozen FROM tracepoint_cutover.write_fence_state WHERE id=1) AS frozen,
  (SELECT active FROM tracepoint_cutover.storage_policy_guard_probe WHERE id=1) AS storage_guard_active;
