-- TracePoint Permissions & RLS Hardening v1
-- Run in Supabase SQL Editor after installing the application patch.
-- Idempotent: safe to run more than once.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Canonical department access functions
-- ---------------------------------------------------------------------------

create or replace function public.is_active_department_member(
  p_department_id uuid,
  p_user_id uuid
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
    where membership.department_id = p_department_id
      and membership.user_id = p_user_id
      and membership.is_active = true
  );
$$;

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
  select
    exists (
      select 1
      from public.department_memberships membership
      join public.department_membership_roles membership_role
        on membership_role.department_id = membership.department_id
       and membership_role.user_id = membership.user_id
      left join public.department_role_permissions role_permission
        on role_permission.department_id = membership_role.department_id
       and role_permission.role_code = membership_role.role_code
      where membership.department_id = p_department_id
        and membership.user_id = auth.uid()
        and membership.is_active = true
        and (
          role_permission.permission_code = p_permission_code
          or membership_role.role_code in (
            'administrator',
            'department_admin',
            'admin'
          )
        )
    );
$$;

create or replace function public.has_any_department_permission(
  p_department_id uuid,
  p_permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from unnest(coalesce(p_permission_codes, array[]::text[])) permission_code
    where public.has_department_permission(
      p_department_id,
      permission_code
    )
  );
$$;

revoke all on function public.is_active_department_member(uuid, uuid)
  from public, anon;
revoke all on function public.has_department_permission(uuid, text)
  from public, anon;
revoke all on function public.has_any_department_permission(uuid, text[])
  from public, anon;

grant execute on function public.is_active_department_member(uuid, uuid)
  to authenticated;
grant execute on function public.has_department_permission(uuid, text)
  to authenticated;
grant execute on function public.has_any_department_permission(uuid, text[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- Magazine accountability columns and integrity
-- ---------------------------------------------------------------------------

alter table if exists public.firearm_assignments
  add column if not exists magazines_issued integer not null default 0,
  add column if not exists magazine_description text,
  add column if not exists magazines_returned integer,
  add column if not exists magazine_discrepancy_reason text;

do $$
begin
  if to_regclass('public.firearm_assignments') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'firearm_assignments_magazines_issued_nonnegative'
         and conrelid = 'public.firearm_assignments'::regclass
     ) then
    alter table public.firearm_assignments
      add constraint firearm_assignments_magazines_issued_nonnegative
      check (magazines_issued >= 0) not valid;
  end if;

  if to_regclass('public.firearm_assignments') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'firearm_assignments_magazines_returned_nonnegative'
         and conrelid = 'public.firearm_assignments'::regclass
     ) then
    alter table public.firearm_assignments
      add constraint firearm_assignments_magazines_returned_nonnegative
      check (
        magazines_returned is null
        or magazines_returned >= 0
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helper for replacing every policy on a table
-- ---------------------------------------------------------------------------

create or replace function public.tracepoint_drop_table_policies(
  p_table_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = p_table_name
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_record.policyname,
      p_table_name
    );
  end loop;
end;
$$;

revoke all on function public.tracepoint_drop_table_policies(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Firearms
-- ---------------------------------------------------------------------------

select public.tracepoint_drop_table_policies('firearms');
alter table public.firearms enable row level security;

create policy "firearms_select_scoped"
on public.firearms
for select
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array[
      'manage_firearms',
      'manage_inspections',
      'view_command_dashboard',
      'administer_department'
    ]
  )
  or exists (
    select 1
    from public.firearm_assignments assignment
    where assignment.department_id = firearms.department_id
      and assignment.firearm_id = firearms.id
      and assignment.assigned_to_user_id = auth.uid()
      and assignment.returned_at is null
  )
);

create policy "firearms_insert_managers"
on public.firearms
for insert
to authenticated
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_firearms', 'administer_department']
  )
);

create policy "firearms_update_managers"
on public.firearms
for update
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array[
      'manage_firearms',
      'manage_inspections',
      'administer_department'
    ]
  )
)
with check (
  public.has_any_department_permission(
    department_id,
    array[
      'manage_firearms',
      'manage_inspections',
      'administer_department'
    ]
  )
);

create policy "firearms_delete_administrators"
on public.firearms
for delete
to authenticated
using (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
);

-- ---------------------------------------------------------------------------
-- Firearm assignments
-- ---------------------------------------------------------------------------

select public.tracepoint_drop_table_policies('firearm_assignments');
alter table public.firearm_assignments enable row level security;

create policy "firearm_assignments_select_scoped"
on public.firearm_assignments
for select
to authenticated
using (
  assigned_to_user_id = auth.uid()
  or public.has_any_department_permission(
    department_id,
    array[
      'manage_firearms',
      'manage_inspections',
      'view_command_dashboard',
      'administer_department'
    ]
  )
);

create policy "firearm_assignments_insert_managers"
on public.firearm_assignments
for insert
to authenticated
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_firearms', 'administer_department']
  )
  and public.is_active_department_member(
    department_id,
    assigned_to_user_id
  )
  and exists (
    select 1
    from public.firearms firearm
    where firearm.id = firearm_assignments.firearm_id
      and firearm.department_id =
        firearm_assignments.department_id
  )
);

create policy "firearm_assignments_update_managers"
on public.firearm_assignments
for update
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_firearms', 'administer_department']
  )
)
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_firearms', 'administer_department']
  )
);

create policy "firearm_assignments_delete_administrators"
on public.firearm_assignments
for delete
to authenticated
using (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
);

-- ---------------------------------------------------------------------------
-- Immutable firearm status history
-- ---------------------------------------------------------------------------

select public.tracepoint_drop_table_policies('firearm_status_history');
alter table public.firearm_status_history enable row level security;

create policy "firearm_status_history_select_scoped"
on public.firearm_status_history
for select
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array[
      'manage_firearms',
      'manage_inspections',
      'view_command_dashboard',
      'administer_department'
    ]
  )
  or exists (
    select 1
    from public.firearm_assignments assignment
    where assignment.department_id =
      firearm_status_history.department_id
      and assignment.firearm_id =
        firearm_status_history.firearm_id
      and assignment.assigned_to_user_id = auth.uid()
  )
);

create policy "firearm_status_history_insert_managers"
on public.firearm_status_history
for insert
to authenticated
with check (
  public.has_any_department_permission(
    department_id,
    array[
      'manage_firearms',
      'manage_inspections',
      'administer_department'
    ]
  )
  and changed_by_user_id = auth.uid()
);

-- No UPDATE or DELETE policy: history is immutable to authenticated users.

-- ---------------------------------------------------------------------------
-- Firearm inspections, when present
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.firearm_inspections') is not null then
    perform public.tracepoint_drop_table_policies(
      'firearm_inspections'
    );

    execute
      'alter table public.firearm_inspections enable row level security';

    execute $policy$
      create policy "firearm_inspections_select_scoped"
      on public.firearm_inspections
      for select
      to authenticated
      using (
        public.has_any_department_permission(
          department_id,
          array[
            'manage_firearms',
            'manage_inspections',
            'view_command_dashboard',
            'administer_department'
          ]
        )
        or exists (
          select 1
          from public.firearm_assignments assignment
          where assignment.department_id =
            firearm_inspections.department_id
            and assignment.firearm_id =
              firearm_inspections.firearm_id
            and assignment.assigned_to_user_id = auth.uid()
        )
      )
    $policy$;

    execute $policy$
      create policy "firearm_inspections_insert_managers"
      on public.firearm_inspections
      for insert
      to authenticated
      with check (
        public.has_any_department_permission(
          department_id,
          array[
            'manage_firearms',
            'manage_inspections',
            'administer_department'
          ]
        )
      )
    $policy$;

    execute $policy$
      create policy "firearm_inspections_update_managers"
      on public.firearm_inspections
      for update
      to authenticated
      using (
        public.has_any_department_permission(
          department_id,
          array[
            'manage_firearms',
            'manage_inspections',
            'administer_department'
          ]
        )
      )
      with check (
        public.has_any_department_permission(
          department_id,
          array[
            'manage_firearms',
            'manage_inspections',
            'administer_department'
          ]
        )
      )
    $policy$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Personally owned rifles
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.personal_rifles') is not null then
    perform public.tracepoint_drop_table_policies('personal_rifles');
    execute
      'alter table public.personal_rifles enable row level security';

    execute $policy$
      create policy "personal_rifles_select_scoped"
      on public.personal_rifles
      for select
      to authenticated
      using (
        owner_user_id = auth.uid()
        or public.has_any_department_permission(
          department_id,
          array[
            'manage_firearms',
            'manage_inspections',
            'view_command_dashboard',
            'administer_department'
          ]
        )
      )
    $policy$;

    execute $policy$
      create policy "personal_rifles_insert_owner"
      on public.personal_rifles
      for insert
      to authenticated
      with check (
        owner_user_id = auth.uid()
        and public.is_active_department_member(
          department_id,
          auth.uid()
        )
      )
    $policy$;

    execute $policy$
      create policy "personal_rifles_update_owner_or_reviewer"
      on public.personal_rifles
      for update
      to authenticated
      using (
        (
          owner_user_id = auth.uid()
          and status in ('Draft', 'Correction Requested')
        )
        or public.has_any_department_permission(
          department_id,
          array[
            'manage_firearms',
            'manage_inspections',
            'view_command_dashboard',
            'administer_department'
          ]
        )
      )
      with check (
        (
          owner_user_id = auth.uid()
          and public.is_active_department_member(
            department_id,
            auth.uid()
          )
        )
        or public.has_any_department_permission(
          department_id,
          array[
            'manage_firearms',
            'manage_inspections',
            'view_command_dashboard',
            'administer_department'
          ]
        )
      )
    $policy$;

    execute $policy$
      create policy "personal_rifles_delete_draft_or_admin"
      on public.personal_rifles
      for delete
      to authenticated
      using (
        (
          owner_user_id = auth.uid()
          and status = 'Draft'
        )
        or public.has_department_permission(
          department_id,
          'administer_department'
        )
      )
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.personal_rifle_status_history') is not null then
    perform public.tracepoint_drop_table_policies(
      'personal_rifle_status_history'
    );
    execute
      'alter table public.personal_rifle_status_history enable row level security';

    execute $policy$
      create policy "personal_rifle_history_select_scoped"
      on public.personal_rifle_status_history
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.personal_rifles rifle
          where rifle.id =
            personal_rifle_status_history.personal_rifle_id
            and (
              rifle.owner_user_id = auth.uid()
              or public.has_any_department_permission(
                rifle.department_id,
                array[
                  'manage_firearms',
                  'manage_inspections',
                  'view_command_dashboard',
                  'administer_department'
                ]
              )
            )
        )
      )
    $policy$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Notification records: each user controls only their own rows
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.notification_events') is not null then
    perform public.tracepoint_drop_table_policies('notification_events');
    execute
      'alter table public.notification_events enable row level security';

    execute $policy$
      create policy "notification_events_own_rows"
      on public.notification_events
      for all
      to authenticated
      using (
        user_id = auth.uid()
        and public.is_active_department_member(
          department_id,
          auth.uid()
        )
      )
      with check (
        user_id = auth.uid()
        and public.is_active_department_member(
          department_id,
          auth.uid()
        )
      )
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.notification_preferences') is not null then
    perform public.tracepoint_drop_table_policies(
      'notification_preferences'
    );
    execute
      'alter table public.notification_preferences enable row level security';

    execute $policy$
      create policy "notification_preferences_own_rows"
      on public.notification_preferences
      for all
      to authenticated
      using (
        user_id = auth.uid()
        and public.is_active_department_member(
          department_id,
          auth.uid()
        )
      )
      with check (
        user_id = auth.uid()
        and public.is_active_department_member(
          department_id,
          auth.uid()
        )
      )
    $policy$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Department configuration and access-control metadata
-- ---------------------------------------------------------------------------

select public.tracepoint_drop_table_policies('departments');
alter table public.departments enable row level security;

create policy "departments_select_members"
on public.departments
for select
to authenticated
using (
  public.is_active_department_member(id, auth.uid())
);

create policy "departments_update_administrators"
on public.departments
for update
to authenticated
using (
  public.has_department_permission(
    id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    id,
    'administer_department'
  )
);

do $$
begin
  if to_regclass('public.department_rules') is not null then
    perform public.tracepoint_drop_table_policies('department_rules');
    execute
      'alter table public.department_rules enable row level security';

    execute $policy$
      create policy "department_rules_select_members"
      on public.department_rules
      for select
      to authenticated
      using (
        public.is_active_department_member(
          department_id,
          auth.uid()
        )
      )
    $policy$;

    execute $policy$
      create policy "department_rules_manage_administrators"
      on public.department_rules
      for all
      to authenticated
      using (
        public.has_department_permission(
          department_id,
          'administer_department'
        )
      )
      with check (
        public.has_department_permission(
          department_id,
          'administer_department'
        )
      )
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.department_security_settings') is not null then
    perform public.tracepoint_drop_table_policies(
      'department_security_settings'
    );
    execute
      'alter table public.department_security_settings enable row level security';

    execute $policy$
      create policy "department_security_select_administrators"
      on public.department_security_settings
      for select
      to authenticated
      using (
        public.has_department_permission(
          department_id,
          'administer_department'
        )
      )
    $policy$;

    execute $policy$
      create policy "department_security_manage_administrators"
      on public.department_security_settings
      for all
      to authenticated
      using (
        public.has_department_permission(
          department_id,
          'administer_department'
        )
      )
      with check (
        public.has_department_permission(
          department_id,
          'administer_department'
        )
      )
    $policy$;
  end if;
end $$;

select public.tracepoint_drop_table_policies(
  'department_memberships'
);
alter table public.department_memberships enable row level security;

create policy "department_memberships_select_self_or_admin"
on public.department_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_any_department_permission(
    department_id,
    array['manage_users', 'administer_department']
  )
);

create policy "department_memberships_manage_administrators"
on public.department_memberships
for all
to authenticated
using (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
);

select public.tracepoint_drop_table_policies(
  'department_membership_roles'
);
alter table public.department_membership_roles
  enable row level security;

create policy "membership_roles_select_self_or_admin"
on public.department_membership_roles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_any_department_permission(
    department_id,
    array['manage_users', 'administer_department']
  )
);

create policy "membership_roles_manage_administrators"
on public.department_membership_roles
for all
to authenticated
using (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
);

select public.tracepoint_drop_table_policies(
  'department_role_permissions'
);
alter table public.department_role_permissions
  enable row level security;

create policy "role_permissions_select_administrators"
on public.department_role_permissions
for select
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_users', 'administer_department']
  )
);

create policy "role_permissions_manage_administrators"
on public.department_role_permissions
for all
to authenticated
using (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
)
with check (
  public.has_department_permission(
    department_id,
    'administer_department'
  )
);

-- Profiles remain self-readable, with user administrators able to read members
-- in departments they administer.
select public.tracepoint_drop_table_policies('profiles');
alter table public.profiles enable row level security;

create policy "profiles_select_self_or_department_admin"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.department_memberships target_membership
    where target_membership.user_id = profiles.id
      and public.has_any_department_permission(
        target_membership.department_id,
        array['manage_users', 'administer_department']
      )
  )
);

create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Audit event visibility, when present
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.audit_events') is not null then
    perform public.tracepoint_drop_table_policies('audit_events');
    execute
      'alter table public.audit_events enable row level security';

    execute $policy$
      create policy "audit_events_select_authorized"
      on public.audit_events
      for select
      to authenticated
      using (
        public.has_any_department_permission(
          department_id,
          array[
            'view_audit_log',
            'administer_department'
          ]
        )
      )
    $policy$;

    execute $policy$
      create policy "audit_events_insert_managers"
      on public.audit_events
      for insert
      to authenticated
      with check (
        actor_user_id = auth.uid()
        and public.has_any_department_permission(
          department_id,
          array[
            'manage_users',
            'manage_firearms',
            'manage_inspections',
            'manage_range_days',
            'manage_qualifications',
            'review_off_duty_requests',
            'administer_department'
          ]
        )
      )
    $policy$;
  end if;
end $$;

drop function public.tracepoint_drop_table_policies(text);

commit;

-- Verification output
select
  tablename,
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'firearms',
    'firearm_assignments',
    'firearm_status_history',
    'firearm_inspections',
    'personal_rifles',
    'personal_rifle_status_history',
    'notification_events',
    'notification_preferences',
    'departments',
    'department_rules',
    'department_security_settings',
    'department_memberships',
    'department_membership_roles',
    'department_role_permissions',
    'profiles',
    'audit_events'
  )
order by tablename, policyname;
