begin;

-- Permissions that shipped in TypeScript before they were registered in the
-- database were invisible in Settings and could never be granted.
insert into public.permissions (code, display_name, description)
values
  ('manage_certifications', 'Manage Certifications', 'Manage certification types, requirements, officer certification records, and certification evidence.'),
  ('manage_training', 'Manage Agency Training', 'Create and manage agency training courses, events, rosters, attendance, closeout, remediation, and training exports.'),
  ('manage_equipment', 'Manage Equipment', 'Create, edit, assign, archive, and remove equipment assets, types, and readiness requirements; members retain access to their own assignments.'),
  ('approve_personal_rifles', 'Approve Personal Rifles', 'Perform final department approval, denial, and revocation of personally owned rifle requests after armorer review.')
on conflict (code) do update
set display_name = excluded.display_name,
    description = excluded.description;

-- Preserve the behavior that older, over-broad policy checks provided, but
-- express it as editable permission rows. Administrators do not need rows.
insert into public.role_permissions (role_code, permission_code)
select role_code, 'manage_certifications'
from public.role_permissions
where permission_code = 'manage_qualifications'
  and role_code <> 'administrator'
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select distinct role_code, 'manage_training'
from public.role_permissions
where permission_code in ('manage_range_days', 'manage_certifications')
  and role_code <> 'administrator'
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select 'chief', 'approve_personal_rifles'
where exists (select 1 from public.roles where code = 'chief')
on conflict do nothing;

insert into public.department_role_permissions (department_id, role_code, permission_code, granted_by)
select department_id, role_code, 'manage_certifications', granted_by
from public.department_role_permissions
where permission_code = 'manage_qualifications'
  and role_code <> 'administrator'
on conflict do nothing;

insert into public.department_role_permissions (department_id, role_code, permission_code, granted_by)
select distinct department_id, role_code, 'manage_training', granted_by
from public.department_role_permissions
where permission_code in ('manage_range_days', 'manage_certifications')
  and role_code <> 'administrator'
on conflict do nothing;

insert into public.department_role_permissions (department_id, role_code, permission_code, granted_by)
select department.id, 'chief', 'approve_personal_rifles', department.created_by
from public.departments department
where exists (select 1 from public.roles where code = 'chief')
on conflict do nothing;

-- One canonical rule: an active member with the exact Administrator role
-- inherits every catalog permission, including permissions added later.
create or replace function public.has_department_permission(
  p_department_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.department_memberships membership
    join public.department_membership_roles membership_role
      on membership_role.department_id = membership.department_id
     and membership_role.user_id = membership.user_id
    where membership.department_id = p_department_id
      and membership.user_id = auth.uid()
      and membership.is_active = true
      and exists (
        select 1 from public.permissions permission
        where permission.code = p_permission_code
      )
      and (
        membership_role.role_code = 'administrator'
        or exists (
          select 1
          from public.department_role_permissions role_permission
          where role_permission.department_id = membership_role.department_id
            and role_permission.role_code = membership_role.role_code
            and role_permission.permission_code = p_permission_code
        )
      )
  );
$$;

revoke all on function public.has_department_permission(uuid, text) from public, anon;
grant execute on function public.has_department_permission(uuid, text) to authenticated;

-- Platform administrators may manage only an explicitly selected department
-- through the authenticated RPC. Ordinary department administrators remain
-- tenant-bound by has_department_permission.
drop function if exists public.set_department_role_permissions(uuid, text, text[]);
create function public.set_department_role_permissions(
  p_department_id uuid,
  p_role_code text,
  p_permission_codes text[]
)
returns text[]
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_permissions text[];
  previous_permissions text[];
  invalid_permission_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if not public.has_department_permission(p_department_id, 'administer_department')
     and not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'Department administration permission is required.';
  end if;
  if p_role_code = 'administrator' then
    raise exception using errcode = '42501', message = 'Administrator permissions are inherited and cannot be edited.';
  end if;
  if not exists (select 1 from public.departments where id = p_department_id)
     or not exists (select 1 from public.roles where code = p_role_code) then
    raise exception using errcode = '22023', message = 'The selected department or role does not exist.';
  end if;

  select coalesce(array_agg(distinct requested.permission_code order by requested.permission_code), array[]::text[])
    into normalized_permissions
  from unnest(coalesce(p_permission_codes, array[]::text[])) requested(permission_code)
  where nullif(trim(requested.permission_code), '') is not null;

  if 'administer_department' = any(normalized_permissions) then
    raise exception using errcode = '42501', message = 'Administer Department is reserved for the Administrator role.';
  end if;
  select count(*) into invalid_permission_count
  from unnest(normalized_permissions) requested(permission_code)
  left join public.permissions permission on permission.code = requested.permission_code
  where permission.code is null;
  if invalid_permission_count > 0 then
    raise exception using errcode = '22023', message = 'One or more requested permissions are invalid.';
  end if;

  select coalesce(array_agg(permission_code order by permission_code), array[]::text[])
    into previous_permissions
  from public.department_role_permissions
  where department_id = p_department_id and role_code = p_role_code;

  delete from public.department_role_permissions
  where department_id = p_department_id and role_code = p_role_code;
  insert into public.department_role_permissions (department_id, role_code, permission_code, granted_by)
  select p_department_id, p_role_code, permission_code, auth.uid()
  from unnest(normalized_permissions) permission_code;

  insert into public.audit_events (department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
  values (
    p_department_id, auth.uid(), 'role_permissions_updated', 'department_role', p_department_id,
    format('Permissions updated for %s.', p_role_code),
    jsonb_build_object('role_code', p_role_code, 'permission_codes', previous_permissions),
    jsonb_build_object('role_code', p_role_code, 'permission_codes', normalized_permissions)
  );
  return normalized_permissions;
end;
$$;
revoke all on function public.set_department_role_permissions(uuid, text, text[]) from public, anon;
grant execute on function public.set_department_role_permissions(uuid, text, text[]) to authenticated;

-- Restore the validation and final-administrator safeguards lost when the
-- platform-support overload replaced this RPC.
create or replace function public.set_department_member_roles(
  p_department_id uuid,
  p_user_id uuid,
  p_role_codes text[]
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  existing_roles text[];
  normalized_roles text[];
  target_is_active boolean;
  actor_can_administer boolean;
begin
  actor_can_administer := public.has_department_permission(p_department_id, 'administer_department') or public.is_platform_admin();
  if not (public.has_department_permission(p_department_id, 'manage_users') or actor_can_administer) then
    raise exception using errcode = '42501', message = 'User-management permission is required.';
  end if;
  select is_active into target_is_active from public.department_memberships
  where department_id = p_department_id and user_id = p_user_id;
  if target_is_active is null then raise exception using errcode = 'P0002', message = 'Department membership was not found.'; end if;
  select coalesce(array_agg(distinct role_code order by role_code), array[]::text[])
    into normalized_roles
  from unnest(coalesce(p_role_codes, array[]::text[])) role_code
  where nullif(trim(role_code), '') is not null;
  if target_is_active and cardinality(normalized_roles) = 0 then
    raise exception using errcode = '23514', message = 'An active member must have at least one role.';
  end if;
  if exists (
    select 1
    from unnest(normalized_roles) requested(code)
    left join public.roles role on role.code = requested.code
    where role.code is null
  ) then
    raise exception using errcode = '22023', message = 'One or more requested roles are invalid.';
  end if;
  select coalesce(array_agg(role_code order by role_code), array[]::text[]) into existing_roles
  from public.department_membership_roles where department_id = p_department_id and user_id = p_user_id;
  if ('administrator' = any(existing_roles) or 'administrator' = any(normalized_roles)) and not actor_can_administer then
    raise exception using errcode = '42501', message = 'Only a department or platform Administrator may modify the Administrator role.';
  end if;
  if 'administrator' = any(existing_roles) and not 'administrator' = any(normalized_roles) and not exists (
    select 1 from public.department_membership_roles other_role
    join public.department_memberships other_member using (department_id, user_id)
    where other_role.department_id = p_department_id and other_role.role_code = 'administrator'
      and other_role.user_id <> p_user_id and other_member.is_active
  ) then
    raise exception using errcode = '23514', message = 'The department must retain at least one active Administrator.';
  end if;
  delete from public.department_membership_roles
  where department_id = p_department_id
    and user_id = p_user_id
    and not (role_code = any(normalized_roles));
  insert into public.department_membership_roles (department_id, user_id, role_code, assigned_by)
  select p_department_id, p_user_id, role_code, auth.uid()
  from unnest(normalized_roles) role_code
  on conflict (department_id, user_id, role_code) do nothing;
  insert into public.audit_events (department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
  values (p_department_id, auth.uid(), 'roles_updated', 'department_membership', p_user_id, 'Department member roles updated.',
    jsonb_build_object('role_codes', existing_roles), jsonb_build_object('role_codes', normalized_roles));
end;
$$;
revoke all on function public.set_department_member_roles(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_department_member_roles(uuid, uuid, text[]) to authenticated;

create or replace function public.protect_final_department_administrator()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  loses_administrator boolean := false;
  protected_department_id uuid;
  protected_user_id uuid;
begin
  if tg_table_name = 'department_membership_roles' then
    protected_department_id := old.department_id;
    protected_user_id := old.user_id;
    loses_administrator := old.role_code = 'administrator'
      and (tg_op = 'DELETE' or new.role_code is distinct from 'administrator'
        or new.department_id is distinct from old.department_id or new.user_id is distinct from old.user_id);
  else
    protected_department_id := old.department_id;
    protected_user_id := old.user_id;
    loses_administrator := exists (
      select 1 from public.department_membership_roles role
      where role.department_id = old.department_id and role.user_id = old.user_id and role.role_code = 'administrator'
    ) and (tg_op = 'DELETE' or new.is_active = false or new.department_id is distinct from old.department_id or new.user_id is distinct from old.user_id);
  end if;
  if loses_administrator and exists (
    select 1 from public.department_memberships member
    where member.department_id = protected_department_id and member.user_id = protected_user_id and member.is_active
  ) and not exists (
    select 1 from public.department_membership_roles role
    join public.department_memberships member using (department_id, user_id)
    where role.department_id = protected_department_id and role.role_code = 'administrator'
      and role.user_id <> protected_user_id and member.is_active
  ) then
    raise exception using errcode = '23514', message = 'The department must retain at least one active Administrator.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_final_administrator_membership on public.department_memberships;
create trigger protect_final_administrator_membership
before update or delete on public.department_memberships
for each row execute function public.protect_final_department_administrator();
drop trigger if exists protect_final_administrator_role on public.department_membership_roles;
create trigger protect_final_administrator_role
before update or delete on public.department_membership_roles
for each row execute function public.protect_final_department_administrator();

create or replace function public.protect_reserved_department_permission()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role_code = 'administrator' then
    raise exception using errcode = '42501', message = 'Administrator permissions are inherited and cannot be edited.';
  end if;
  if new.permission_code = 'administer_department' then
    raise exception using errcode = '42501', message = 'Administer Department is reserved for the Administrator role.';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_reserved_department_permission on public.department_role_permissions;
create trigger protect_reserved_department_permission
before insert or update on public.department_role_permissions
for each row execute function public.protect_reserved_department_permission();

-- New departments inherit Administrator access dynamically.  The legacy seed
-- function copied global Administrator rows into each department, which would
-- both make future permissions stale and conflict with the guard above.
create or replace function public.seed_department_configuration()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.department_rules (department_id)
  values (new.id)
  on conflict (department_id) do nothing;

  insert into public.department_security_settings (department_id)
  values (new.id)
  on conflict (department_id) do nothing;

  insert into public.department_role_permissions (
    department_id,
    role_code,
    permission_code,
    granted_by
  )
  select
    new.id,
    role_permission.role_code,
    role_permission.permission_code,
    coalesce(new.created_by, auth.uid())
  from public.role_permissions role_permission
  where role_permission.role_code <> 'administrator'
    and role_permission.permission_code <> 'administer_department'
  on conflict (department_id, role_code, permission_code) do nothing;

  return new;
end;
$$;

drop function if exists public.get_department_members(uuid);
create function public.get_department_members(p_department_id uuid)
returns table (user_id uuid, full_name text, email text, badge_number text, rank_title text, unit_name text, employee_number text, is_active boolean, joined_at timestamptz, activation_status text, role_codes text[], effective_permissions text[])
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not (public.has_department_permission(p_department_id, 'manage_users') or public.has_department_permission(p_department_id, 'administer_department') or public.is_platform_admin()) then
    raise exception using errcode = '42501', message = 'User-management permission is required.';
  end if;
  return query
  select member.user_id, profile.full_name, profile.email, member.badge_number, member.rank_title, member.unit_name,
    member.employee_number, member.is_active, member.joined_at, member.activation_status,
    coalesce(array_agg(distinct member_role.role_code) filter (where member_role.role_code is not null), array[]::text[]),
    case when bool_or(member_role.role_code = 'administrator')
      then array(select permission.code from public.permissions permission order by permission.code)
      else coalesce(array_agg(distinct role_permission.permission_code) filter (where role_permission.permission_code is not null), array[]::text[])
    end
  from public.department_memberships member
  join public.profiles profile on profile.id = member.user_id
  left join public.department_membership_roles member_role using (department_id, user_id)
  left join public.department_role_permissions role_permission
    on role_permission.department_id = member_role.department_id and role_permission.role_code = member_role.role_code
  where member.department_id = p_department_id
  group by member.user_id, profile.full_name, profile.email, member.badge_number, member.rank_title, member.unit_name,
    member.employee_number, member.is_active, member.joined_at, member.activation_status
  order by profile.full_name;
end;
$$;
revoke all on function public.get_department_members(uuid) from public, anon;
grant execute on function public.get_department_members(uuid) to authenticated;

-- Correct permission-to-table mappings that made unchecked permissions look
-- ineffective. Read-only department-member policies are intentionally kept.
drop policy if exists "training managers can manage certification types" on public.certification_types;
drop policy if exists "certification managers can manage certification types" on public.certification_types;
create policy "certification managers can manage certification types" on public.certification_types for all to authenticated
using (public.has_department_permission(department_id, 'manage_certifications'))
with check (public.has_department_permission(department_id, 'manage_certifications'));
drop policy if exists "training managers can manage certification requirements" on public.department_certification_requirements;
drop policy if exists "certification managers can manage certification requirements" on public.department_certification_requirements;
create policy "certification managers can manage certification requirements" on public.department_certification_requirements for all to authenticated
using (public.has_department_permission(department_id, 'manage_certifications'))
with check (public.has_department_permission(department_id, 'manage_certifications'));
drop policy if exists "training managers can insert certifications" on public.training_certifications;
drop policy if exists "training managers can update certifications" on public.training_certifications;
drop policy if exists "training managers can delete certifications" on public.training_certifications;
drop policy if exists "certification managers can insert certifications" on public.training_certifications;
drop policy if exists "certification managers can update certifications" on public.training_certifications;
drop policy if exists "certification managers can delete certifications" on public.training_certifications;
create policy "certification managers can insert certifications" on public.training_certifications for insert to authenticated
with check (public.has_department_permission(department_id, 'manage_certifications'));
create policy "certification managers can update certifications" on public.training_certifications for update to authenticated
using (public.has_department_permission(department_id, 'manage_certifications'))
with check (public.has_department_permission(department_id, 'manage_certifications'));
create policy "certification managers can delete certifications" on public.training_certifications for delete to authenticated
using (public.has_department_permission(department_id, 'manage_certifications'));

do $$
declare t text; p record;
begin
  foreach t in array array['agency_training_events','agency_training_event_instructors','agency_training_attendees','agency_training_certificates','agency_training_courses','agency_training_course_aliases','agency_training_requirements','agency_training_requirement_members'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t and cmd <> 'SELECT' loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for all to authenticated using (public.has_department_permission(department_id, %L)) with check (public.has_department_permission(department_id, %L))', t || '_manage_training', t, 'manage_training', 'manage_training');
  end loop;
end $$;

-- Direct database personal-rifle visibility and review no longer depends on a
-- command role name or the unrelated dashboard permission.
drop policy if exists "personal_rifles_select_scoped" on public.personal_rifles;
create policy "personal_rifles_select_scoped" on public.personal_rifles for select to authenticated
using (owner_user_id = auth.uid() or public.has_any_department_permission(department_id, array['manage_inspections','approve_personal_rifles']));
drop policy if exists "personal_rifles_update_owner_or_reviewer" on public.personal_rifles;
create policy "personal_rifles_update_owner_or_reviewer" on public.personal_rifles for update to authenticated
using ((owner_user_id = auth.uid() and status in ('Draft','Correction Requested')) or public.has_any_department_permission(department_id, array['manage_inspections','approve_personal_rifles']))
with check ((owner_user_id = auth.uid() and public.is_active_department_member(department_id, auth.uid())) or public.has_any_department_permission(department_id, array['manage_inspections','approve_personal_rifles']));

drop policy if exists "personal_rifle_history_select_scoped" on public.personal_rifle_status_history;
create policy "personal_rifle_history_select_scoped" on public.personal_rifle_status_history for select to authenticated
using (exists (
  select 1 from public.personal_rifles rifle
  where rifle.id = personal_rifle_status_history.personal_rifle_id
    and rifle.department_id = personal_rifle_status_history.department_id
    and (rifle.owner_user_id = auth.uid() or public.has_any_department_permission(rifle.department_id, array['manage_inspections','approve_personal_rifles']))
));

commit;
