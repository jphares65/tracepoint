-- TracePoint Equipment RLS hardening
-- Normal tenant requests use authenticated RLS.
-- Verified Platform Support Mode continues to use the service-role client.

alter table public.equipment_assets enable row level security;
alter table public.equipment_types enable row level security;
alter table public.department_equipment_requirements enable row level security;

do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'equipment_assets',
    'equipment_types',
    'department_equipment_requirements'
  ]
  loop
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        policy_row.policyname,
        table_name
      );
    end loop;
  end loop;
end
$$;

create policy "equipment_assets_select_scoped"
on public.equipment_assets
for select
to authenticated
using (
  public.is_active_department_member(department_id, auth.uid())
  and (
    assigned_user_id = auth.uid()
    or public.has_any_department_permission(
      department_id,
      array['manage_equipment', 'administer_department']
    )
  )
);

create policy "equipment_assets_insert_managers"
on public.equipment_assets
for insert
to authenticated
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);

create policy "equipment_assets_update_managers"
on public.equipment_assets
for update
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
)
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);

create policy "equipment_assets_delete_managers"
on public.equipment_assets
for delete
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);




create policy "equipment_types_select_members"
on public.equipment_types
for select
to authenticated
using (
  public.is_active_department_member(department_id, auth.uid())
);

create policy "equipment_types_insert_managers"
on public.equipment_types
for insert
to authenticated
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);

create policy "equipment_types_update_managers"
on public.equipment_types
for update
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
)
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);

create policy "equipment_types_delete_managers"
on public.equipment_types
for delete
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);




create policy "equipment_requirements_select_members"
on public.department_equipment_requirements
for select
to authenticated
using (
  public.is_active_department_member(department_id, auth.uid())
);

create policy "equipment_requirements_insert_managers"
on public.department_equipment_requirements
for insert
to authenticated
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);

create policy "equipment_requirements_update_managers"
on public.department_equipment_requirements
for update
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
)
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);

create policy "equipment_requirements_delete_managers"
on public.department_equipment_requirements
for delete
to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_equipment', 'administer_department']
  )
);


-- Equipment managers need department personnel for assignment/readiness UX.

drop policy if exists "department_memberships_select_self_or_admin"
on public.department_memberships;

create policy "department_memberships_select_self_or_admin"
on public.department_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_any_department_permission(
    department_id,
    array[
      'manage_users',
      'manage_equipment',
      'administer_department'
    ]
  )
);


drop policy if exists "profiles_select_self_or_department_admin"
on public.profiles;

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
      and target_membership.is_active = true
      and public.has_any_department_permission(
        target_membership.department_id,
        array[
          'manage_users',
          'manage_equipment',
          'administer_department'
        ]
      )
  )
);