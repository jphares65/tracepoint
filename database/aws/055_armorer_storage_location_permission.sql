begin;

-- SV-31 follow-up. Storage-location management (028/029/034) requires
-- firearm_custody.manage_storage_locations, and the application now asks for the
-- same permission on every layer. The Armorer role was never given it: armorers
-- saw the storage-location controls (the old UI also accepted manage_firearms)
-- but every change was refused by the database. Grant it to the Armorer role by
-- default and in every agency, so armorers can do what the screen offered.
-- Administrators already hold every permission (has_department_permission).
-- Agencies can remove the grant in Settings. Idempotent.

insert into public.role_permissions (role_code, permission_code)
select 'armorer', 'firearm_custody.manage_storage_locations'
where exists (select 1 from public.roles where code = 'armorer')
  and exists (select 1 from public.permissions where code = 'firearm_custody.manage_storage_locations')
on conflict (role_code, permission_code) do nothing;

with granted as (
  insert into public.department_role_permissions (department_id, role_code, permission_code, granted_by)
  select department.id, 'armorer', 'firearm_custody.manage_storage_locations', null
  from public.departments department
  where exists (select 1 from public.roles where code = 'armorer')
    and exists (select 1 from public.permissions where code = 'firearm_custody.manage_storage_locations')
  on conflict (department_id, role_code, permission_code) do nothing
  returning department_id
)
insert into public.audit_events (department_id, actor_user_id, action, entity_type, entity_id, summary, details)
select department_id, null, 'role_permission_granted', 'department_role_permission', null,
  'Migration 055 (system) granted Manage Firearm Storage Locations to the Armorer role, matching the storage-location screen.',
  jsonb_build_object('migration', '055', 'role_code', 'armorer', 'permission_code', 'firearm_custody.manage_storage_locations')
from granted;

commit;
