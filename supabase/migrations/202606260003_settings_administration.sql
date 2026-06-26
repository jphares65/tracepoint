-- TracePoint functional Settings administration
-- Adds department profile fields, operational/security settings,
-- department-specific role permissions, user administration RPCs,
-- audit coverage, and department patch storage.

begin;

-- ---------------------------------------------------------------------------
-- Department profile and branding fields
-- ---------------------------------------------------------------------------

alter table public.departments
  add column if not exists state text,
  add column if not exists county text,
  add column if not exists agency_type text not null default 'Municipal Police Department',
  add column if not exists sworn_officers integer not null default 0,
  add column if not exists civilian_staff integer not null default 0,
  add column if not exists primary_contact_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists patch_url text,
  add column if not exists accent_color text not null default 'blue',
  add column if not exists login_theme text not null default 'dark';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'departments_sworn_officers_nonnegative'
  ) then
    alter table public.departments
      add constraint departments_sworn_officers_nonnegative
      check (sworn_officers >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'departments_civilian_staff_nonnegative'
  ) then
    alter table public.departments
      add constraint departments_civilian_staff_nonnegative
      check (civilian_staff >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'departments_login_theme_valid'
  ) then
    alter table public.departments
      add constraint departments_login_theme_valid
      check (login_theme in ('dark', 'light', 'system'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operational and security settings
-- ---------------------------------------------------------------------------

create table if not exists public.department_rules (
  department_id uuid primary key references public.departments(id) on delete cascade,
  spring_cycle_start text not null default '04-01',
  spring_cycle_end text not null default '06-30',
  fall_cycle_start text not null default '09-01',
  fall_cycle_end text not null default '11-30',
  require_rifle_familiarization boolean not null default true,
  inspection_interval_days integer not null default 180,
  battery_check_interval_days integer not null default 180,
  off_duty_renewal_days integer not null default 365,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_rules_spring_start_format
    check (spring_cycle_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  constraint department_rules_spring_end_format
    check (spring_cycle_end ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  constraint department_rules_fall_start_format
    check (fall_cycle_start ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  constraint department_rules_fall_end_format
    check (fall_cycle_end ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  constraint department_rules_inspection_interval_positive
    check (inspection_interval_days between 1 and 3650),
  constraint department_rules_battery_interval_positive
    check (battery_check_interval_days between 1 and 3650),
  constraint department_rules_off_duty_renewal_positive
    check (off_duty_renewal_days between 1 and 3650)
);

create table if not exists public.department_security_settings (
  department_id uuid primary key references public.departments(id) on delete cascade,
  require_mfa_policy boolean not null default false,
  session_timeout_minutes integer not null default 30,
  export_logging_enabled boolean not null default true,
  data_retention_days integer not null default 2555,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_security_session_timeout_valid
    check (session_timeout_minutes between 5 and 1440),
  constraint department_security_retention_valid
    check (data_retention_days between 30 and 36500)
);

-- Global role_permissions remains the product default matrix.
-- Each department receives an editable copy here.
create table if not exists public.department_role_permissions (
  department_id uuid not null references public.departments(id) on delete cascade,
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (department_id, role_code, permission_code)
);

create index if not exists department_role_permissions_lookup_idx
  on public.department_role_permissions(department_id, role_code);

insert into public.department_rules (department_id)
select department.id
from public.departments department
on conflict (department_id) do nothing;

insert into public.department_security_settings (department_id)
select department.id
from public.departments department
on conflict (department_id) do nothing;

insert into public.department_role_permissions (
  department_id,
  role_code,
  permission_code,
  granted_by
)
select
  department.id,
  role_permission.role_code,
  role_permission.permission_code,
  department.created_by
from public.departments department
cross join public.role_permissions role_permission
on conflict (department_id, role_code, permission_code) do nothing;

-- Seed settings and default permissions for future departments.
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
  on conflict (department_id, role_code, permission_code) do nothing;

  return new;
end;
$$;

drop trigger if exists departments_seed_configuration on public.departments;
create trigger departments_seed_configuration
after insert on public.departments
for each row execute function public.seed_department_configuration();

drop trigger if exists department_rules_set_updated_at on public.department_rules;
create trigger department_rules_set_updated_at
before update on public.department_rules
for each row execute function public.set_updated_at();

drop trigger if exists department_security_set_updated_at on public.department_security_settings;
create trigger department_security_set_updated_at
before update on public.department_security_settings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Department-aware authorization
-- ---------------------------------------------------------------------------

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
    from public.department_membership_roles membership_role
    join public.department_memberships membership
      on membership.department_id = membership_role.department_id
     and membership.user_id = membership_role.user_id
    join public.department_role_permissions role_permission
      on role_permission.department_id = membership_role.department_id
     and role_permission.role_code = membership_role.role_code
    where membership_role.department_id = p_department_id
      and membership_role.user_id = auth.uid()
      and role_permission.permission_code = p_permission_code
      and membership.is_active
  );
$$;

create or replace function public.can_manage_department_member(
  p_department_id uuid,
  p_target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    public.has_department_permission(
      p_department_id,
      'administer_department'
    )
    or (
      public.has_department_permission(
        p_department_id,
        'manage_users'
      )
      and not exists (
        select 1
        from public.department_membership_roles target_role
        where target_role.department_id = p_department_id
          and target_role.user_id = p_target_user_id
          and target_role.role_code = 'administrator'
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.department_rules enable row level security;
alter table public.department_security_settings enable row level security;
alter table public.department_role_permissions enable row level security;

drop policy if exists department_rules_select_member on public.department_rules;
create policy department_rules_select_member
on public.department_rules for select
to authenticated
using (public.is_department_member(department_id));

drop policy if exists department_rules_insert_admin on public.department_rules;
create policy department_rules_insert_admin
on public.department_rules for insert
to authenticated
with check (public.has_department_permission(department_id, 'administer_department'));

drop policy if exists department_rules_update_admin on public.department_rules;
create policy department_rules_update_admin
on public.department_rules for update
to authenticated
using (public.has_department_permission(department_id, 'administer_department'))
with check (public.has_department_permission(department_id, 'administer_department'));

drop policy if exists department_security_select_authorized on public.department_security_settings;
create policy department_security_select_authorized
on public.department_security_settings for select
to authenticated
using (
  public.has_department_permission(department_id, 'view_audit_log')
  or public.has_department_permission(department_id, 'administer_department')
);

drop policy if exists department_security_insert_admin on public.department_security_settings;
create policy department_security_insert_admin
on public.department_security_settings for insert
to authenticated
with check (public.has_department_permission(department_id, 'administer_department'));

drop policy if exists department_security_update_admin on public.department_security_settings;
create policy department_security_update_admin
on public.department_security_settings for update
to authenticated
using (public.has_department_permission(department_id, 'administer_department'))
with check (public.has_department_permission(department_id, 'administer_department'));

drop policy if exists department_role_permissions_select_member
  on public.department_role_permissions;
create policy department_role_permissions_select_member
on public.department_role_permissions for select
to authenticated
using (public.is_department_member(department_id));

drop policy if exists department_role_permissions_insert_admin
  on public.department_role_permissions;
create policy department_role_permissions_insert_admin
on public.department_role_permissions for insert
to authenticated
with check (public.has_department_permission(department_id, 'administer_department'));

drop policy if exists department_role_permissions_delete_admin
  on public.department_role_permissions;
create policy department_role_permissions_delete_admin
on public.department_role_permissions for delete
to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

-- Tighten existing membership policies so manage_users cannot modify an
-- Administrator account or grant the Administrator role.
drop policy if exists memberships_update_admin on public.department_memberships;
create policy memberships_update_admin
on public.department_memberships for update
to authenticated
using (public.can_manage_department_member(department_id, user_id))
with check (public.can_manage_department_member(department_id, user_id));

drop policy if exists membership_roles_insert_admin on public.department_membership_roles;
create policy membership_roles_insert_admin
on public.department_membership_roles for insert
to authenticated
with check (
  public.has_department_permission(department_id, 'administer_department')
  or (
    role_code <> 'administrator'
    and public.can_manage_department_member(department_id, user_id)
  )
);

drop policy if exists membership_roles_delete_admin on public.department_membership_roles;
create policy membership_roles_delete_admin
on public.department_membership_roles for delete
to authenticated
using (
  public.has_department_permission(department_id, 'administer_department')
  or (
    role_code <> 'administrator'
    and public.can_manage_department_member(department_id, user_id)
  )
);

-- ---------------------------------------------------------------------------
-- User and permission administration RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_department_members(
  p_department_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  badge_number text,
  rank_title text,
  unit_name text,
  employee_number text,
  is_active boolean,
  joined_at timestamptz,
  role_codes text[],
  effective_permissions text[]
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not (
    public.has_department_permission(p_department_id, 'manage_users')
    or public.has_department_permission(p_department_id, 'administer_department')
  ) then
    raise exception 'You do not have permission to manage department users.';
  end if;

  return query
  select
    membership.user_id,
    profile.full_name,
    profile.email,
    membership.badge_number,
    membership.rank_title,
    membership.unit_name,
    membership.employee_number,
    membership.is_active,
    membership.joined_at,
    coalesce(
      array_agg(distinct membership_role.role_code)
        filter (where membership_role.role_code is not null),
      array[]::text[]
    ) as role_codes,
    coalesce(
      array_agg(distinct role_permission.permission_code)
        filter (where role_permission.permission_code is not null),
      array[]::text[]
    ) as effective_permissions
  from public.department_memberships membership
  join public.profiles profile
    on profile.id = membership.user_id
  left join public.department_membership_roles membership_role
    on membership_role.department_id = membership.department_id
   and membership_role.user_id = membership.user_id
  left join public.department_role_permissions role_permission
    on role_permission.department_id = membership.department_id
   and role_permission.role_code = membership_role.role_code
  where membership.department_id = p_department_id
  group by
    membership.user_id,
    profile.full_name,
    profile.email,
    membership.badge_number,
    membership.rank_title,
    membership.unit_name,
    membership.employee_number,
    membership.is_active,
    membership.joined_at
  order by profile.full_name;
end;
$$;

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
  invalid_role_count integer;
  target_is_active boolean;
  target_is_administrator boolean;
  requested_administrator boolean;
  actor_can_administer boolean;
begin
  actor_can_administer := public.has_department_permission(
    p_department_id,
    'administer_department'
  );

  if not (
    public.has_department_permission(p_department_id, 'manage_users')
    or actor_can_administer
  ) then
    raise exception 'You do not have permission to manage department roles.';
  end if;

  select membership.is_active
  into target_is_active
  from public.department_memberships membership
  where membership.department_id = p_department_id
    and membership.user_id = p_user_id;

  if target_is_active is null then
    raise exception 'Department membership was not found.';
  end if;

  select coalesce(
    array_agg(distinct requested.role_code order by requested.role_code),
    array[]::text[]
  )
  into normalized_roles
  from unnest(coalesce(p_role_codes, array[]::text[])) as requested(role_code)
  where nullif(trim(requested.role_code), '') is not null;

  if target_is_active and cardinality(normalized_roles) = 0 then
    raise exception 'An active member must have at least one role.';
  end if;

  select count(*)
  into invalid_role_count
  from unnest(normalized_roles) as requested(role_code)
  left join public.roles role
    on role.code = requested.role_code
  where role.code is null;

  if invalid_role_count > 0 then
    raise exception 'One or more requested roles are invalid.';
  end if;

  select coalesce(array_agg(role_code order by role_code), array[]::text[])
  into existing_roles
  from public.department_membership_roles
  where department_id = p_department_id
    and user_id = p_user_id;

  target_is_administrator := 'administrator' = any(existing_roles);
  requested_administrator := 'administrator' = any(normalized_roles);

  if (target_is_administrator or requested_administrator)
     and not actor_can_administer then
    raise exception 'Only a department Administrator may modify the Administrator role.';
  end if;

  if
    target_is_administrator
    and not requested_administrator
    and not exists (
      select 1
      from public.department_membership_roles other_role
      join public.department_memberships other_membership
        on other_membership.department_id = other_role.department_id
       and other_membership.user_id = other_role.user_id
      where other_role.department_id = p_department_id
        and other_role.role_code = 'administrator'
        and other_role.user_id <> p_user_id
        and other_membership.is_active
    )
  then
    raise exception 'The department must retain at least one active Administrator.';
  end if;

  delete from public.department_membership_roles
  where department_id = p_department_id
    and user_id = p_user_id;

  insert into public.department_membership_roles (
    department_id,
    user_id,
    role_code,
    assigned_by
  )
  select
    p_department_id,
    p_user_id,
    requested.role_code,
    auth.uid()
  from unnest(normalized_roles) as requested(role_code);

  insert into public.audit_events (
    department_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    summary,
    previous_value,
    new_value
  )
  values (
    p_department_id,
    auth.uid(),
    'roles_updated',
    'department_membership',
    p_user_id,
    'Department member roles updated.',
    jsonb_build_object('role_codes', existing_roles),
    jsonb_build_object('role_codes', normalized_roles)
  );
end;
$$;

create or replace function public.update_department_member(
  p_department_id uuid,
  p_user_id uuid,
  p_badge_number text,
  p_rank_title text,
  p_unit_name text,
  p_employee_number text,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  previous_membership jsonb;
  target_is_administrator boolean;
  actor_can_administer boolean;
begin
  actor_can_administer := public.has_department_permission(
    p_department_id,
    'administer_department'
  );

  if not (
    public.has_department_permission(p_department_id, 'manage_users')
    or actor_can_administer
  ) then
    raise exception 'You do not have permission to manage department users.';
  end if;

  if p_user_id = auth.uid() and not p_is_active then
    raise exception 'You cannot deactivate your own membership.';
  end if;

  select to_jsonb(membership)
  into previous_membership
  from public.department_memberships membership
  where membership.department_id = p_department_id
    and membership.user_id = p_user_id;

  if previous_membership is null then
    raise exception 'Department membership was not found.';
  end if;

  select exists (
    select 1
    from public.department_membership_roles membership_role
    where membership_role.department_id = p_department_id
      and membership_role.user_id = p_user_id
      and membership_role.role_code = 'administrator'
  )
  into target_is_administrator;

  if target_is_administrator and not actor_can_administer then
    raise exception 'Only a department Administrator may modify an Administrator account.';
  end if;

  if
    target_is_administrator
    and not p_is_active
    and not exists (
      select 1
      from public.department_membership_roles other_role
      join public.department_memberships other_membership
        on other_membership.department_id = other_role.department_id
       and other_membership.user_id = other_role.user_id
      where other_role.department_id = p_department_id
        and other_role.role_code = 'administrator'
        and other_role.user_id <> p_user_id
        and other_membership.is_active
    )
  then
    raise exception 'The department must retain at least one active Administrator.';
  end if;

  update public.department_memberships
  set
    badge_number = nullif(trim(p_badge_number), ''),
    rank_title = nullif(trim(p_rank_title), ''),
    unit_name = nullif(trim(p_unit_name), ''),
    employee_number = nullif(trim(p_employee_number), ''),
    is_active = p_is_active,
    deactivated_at = case
      when p_is_active then null
      else coalesce(deactivated_at, now())
    end
  where department_id = p_department_id
    and user_id = p_user_id;

  insert into public.audit_events (
    department_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    summary,
    previous_value,
    new_value
  )
  select
    p_department_id,
    auth.uid(),
    'membership_updated',
    'department_membership',
    p_user_id,
    'Department membership updated.',
    previous_membership,
    to_jsonb(membership)
  from public.department_memberships membership
  where membership.department_id = p_department_id
    and membership.user_id = p_user_id;
end;
$$;

create or replace function public.set_department_role_permissions(
  p_department_id uuid,
  p_role_code text,
  p_permission_codes text[]
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_permissions text[];
  previous_permissions text[];
  invalid_permission_count integer;
begin
  if not public.has_department_permission(
    p_department_id,
    'administer_department'
  ) then
    raise exception 'Only a department Administrator may change the role matrix.';
  end if;

  if p_role_code = 'administrator' then
    raise exception 'The Administrator role is locked to preserve department access.';
  end if;

  if not exists (
    select 1 from public.roles role where role.code = p_role_code
  ) then
    raise exception 'The selected role does not exist.';
  end if;

  select coalesce(
    array_agg(
      distinct requested.permission_code
      order by requested.permission_code
    ),
    array[]::text[]
  )
  into normalized_permissions
  from unnest(
    coalesce(p_permission_codes, array[]::text[])
  ) as requested(permission_code)
  where nullif(trim(requested.permission_code), '') is not null;

  if 'administer_department' = any(normalized_permissions) then
    raise exception 'Administer Department is reserved for the Administrator role.';
  end if;

  select count(*)
  into invalid_permission_count
  from unnest(normalized_permissions) as requested(permission_code)
  left join public.permissions permission
    on permission.code = requested.permission_code
  where permission.code is null;

  if invalid_permission_count > 0 then
    raise exception 'One or more requested permissions are invalid.';
  end if;

  select coalesce(
    array_agg(permission_code order by permission_code),
    array[]::text[]
  )
  into previous_permissions
  from public.department_role_permissions
  where department_id = p_department_id
    and role_code = p_role_code;

  delete from public.department_role_permissions
  where department_id = p_department_id
    and role_code = p_role_code;

  insert into public.department_role_permissions (
    department_id,
    role_code,
    permission_code,
    granted_by
  )
  select
    p_department_id,
    p_role_code,
    requested.permission_code,
    auth.uid()
  from unnest(normalized_permissions) as requested(permission_code);

  insert into public.audit_events (
    department_id,
    actor_user_id,
    action,
    entity_type,
    summary,
    previous_value,
    new_value
  )
  values (
    p_department_id,
    auth.uid(),
    'role_permissions_updated',
    'department_role_permissions',
    'Role permission matrix updated for ' || p_role_code || '.',
    jsonb_build_object(
      'role_code', p_role_code,
      'permission_codes', previous_permissions
    ),
    jsonb_build_object(
      'role_code', p_role_code,
      'permission_codes', normalized_permissions
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit coverage
-- ---------------------------------------------------------------------------

create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_json jsonb;
  new_json jsonb;
  tenant_id uuid;
  entity_uuid uuid;
begin
  old_json := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_json := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  tenant_id := coalesce(
    nullif(new_json ->> 'department_id', '')::uuid,
    nullif(old_json ->> 'department_id', '')::uuid,
    case
      when tg_table_name = 'departments'
      then coalesce(
        nullif(new_json ->> 'id', '')::uuid,
        nullif(old_json ->> 'id', '')::uuid
      )
      else null
    end
  );

  entity_uuid := coalesce(
    nullif(new_json ->> 'id', '')::uuid,
    nullif(old_json ->> 'id', '')::uuid,
    nullif(new_json ->> 'user_id', '')::uuid,
    nullif(old_json ->> 'user_id', '')::uuid
  );

  if tenant_id is not null then
    insert into public.audit_events (
      department_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      previous_value,
      new_value
    )
    values (
      tenant_id,
      auth.uid(),
      lower(tg_op),
      tg_table_name,
      entity_uuid,
      old_json,
      new_json
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists departments_audit on public.departments;
create trigger departments_audit
after update on public.departments
for each row execute function public.write_audit_event();

drop trigger if exists department_rules_audit on public.department_rules;
create trigger department_rules_audit
after insert or update or delete on public.department_rules
for each row execute function public.write_audit_event();

drop trigger if exists department_security_settings_audit on public.department_security_settings;
create trigger department_security_settings_audit
after insert or update or delete on public.department_security_settings
for each row execute function public.write_audit_event();

drop trigger if exists department_memberships_audit on public.department_memberships;
create trigger department_memberships_audit
after insert or update or delete on public.department_memberships
for each row execute function public.write_audit_event();

drop trigger if exists department_membership_roles_audit on public.department_membership_roles;
create trigger department_membership_roles_audit
after insert or update or delete on public.department_membership_roles
for each row execute function public.write_audit_event();

drop trigger if exists department_role_permissions_audit on public.department_role_permissions;
create trigger department_role_permissions_audit
after insert or delete on public.department_role_permissions
for each row execute function public.write_audit_event();

-- ---------------------------------------------------------------------------
-- Department patch storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'department-assets',
  'department-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists department_assets_insert_admin on storage.objects;
create policy department_assets_insert_admin
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'department-assets'
  and public.has_department_permission(
    split_part(name, '/', 1)::uuid,
    'administer_department'
  )
);

drop policy if exists department_assets_update_admin on storage.objects;
create policy department_assets_update_admin
on storage.objects for update
to authenticated
using (
  bucket_id = 'department-assets'
  and public.has_department_permission(
    split_part(name, '/', 1)::uuid,
    'administer_department'
  )
)
with check (
  bucket_id = 'department-assets'
  and public.has_department_permission(
    split_part(name, '/', 1)::uuid,
    'administer_department'
  )
);

drop policy if exists department_assets_delete_admin on storage.objects;
create policy department_assets_delete_admin
on storage.objects for delete
to authenticated
using (
  bucket_id = 'department-assets'
  and public.has_department_permission(
    split_part(name, '/', 1)::uuid,
    'administer_department'
  )
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete
  on public.department_rules to authenticated;
grant select, insert, update, delete
  on public.department_security_settings to authenticated;
grant select, insert, update, delete
  on public.department_role_permissions to authenticated;

revoke all on function public.seed_department_configuration() from public;
revoke all on function public.can_manage_department_member(uuid, uuid) from public;
revoke all on function public.get_department_members(uuid) from public;
revoke all on function public.set_department_member_roles(uuid, uuid, text[]) from public;
revoke all on function public.update_department_member(uuid, uuid, text, text, text, text, boolean) from public;
revoke all on function public.set_department_role_permissions(uuid, text, text[]) from public;

grant execute on function public.can_manage_department_member(uuid, uuid) to authenticated;
grant execute on function public.get_department_members(uuid) to authenticated;
grant execute on function public.set_department_member_roles(uuid, uuid, text[]) to authenticated;
grant execute on function public.update_department_member(uuid, uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.set_department_role_permissions(uuid, text, text[]) to authenticated;

commit;

select
  department.name as department,
  count(distinct membership.user_id) as members,
  count(distinct role_permission.role_code) as configured_roles,
  count(role_permission.permission_code) as permission_grants
from public.departments department
left join public.department_memberships membership
  on membership.department_id = department.id
left join public.department_role_permissions role_permission
  on role_permission.department_id = department.id
group by department.id, department.name
order by department.name;
