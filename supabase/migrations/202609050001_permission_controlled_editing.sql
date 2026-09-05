begin;

-- The pilot bridge was originally distributed as a manual SQL document. Keep
-- clean bootstraps complete while the Range UI finishes moving to relational
-- tables.
create table if not exists public.pilot_range_workspaces (
  department_id uuid primary key references public.departments(id) on delete cascade,
  workspace jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists pilot_range_workspaces_updated_at_idx
  on public.pilot_range_workspaces(updated_at desc);

alter table public.pilot_range_workspaces enable row level security;

drop policy if exists "pilot_range_workspaces_select_members" on public.pilot_range_workspaces;
drop policy if exists "pilot_range_workspaces_insert_members" on public.pilot_range_workspaces;
drop policy if exists "pilot_range_workspaces_update_members" on public.pilot_range_workspaces;
drop policy if exists "pilot_range_workspaces_insert_managers" on public.pilot_range_workspaces;
drop policy if exists "pilot_range_workspaces_update_range_staff" on public.pilot_range_workspaces;

create policy "pilot_range_workspaces_select_members"
on public.pilot_range_workspaces for select to authenticated
using (public.is_active_department_member(department_id, auth.uid()));

create policy "pilot_range_workspaces_insert_managers"
on public.pilot_range_workspaces for insert to authenticated
with check (public.has_department_permission(department_id, 'manage_range_days'));

create policy "pilot_range_workspaces_update_range_staff"
on public.pilot_range_workspaces for update to authenticated
using (
  public.has_any_department_permission(
    department_id,
    array['manage_range_days', 'score_range_days', 'manage_qualifications', 'administer_department']
  )
)
with check (
  public.has_any_department_permission(
    department_id,
    array['manage_range_days', 'score_range_days', 'manage_qualifications', 'administer_department']
  )
);

create or replace function public.range_workspace_collection(
  p_workspace jsonb,
  p_camel_key text,
  p_snake_key text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(p_workspace -> p_camel_key, p_workspace -> p_snake_key, '[]'::jsonb)
$$;

create or replace function public.range_workspace_day_items(
  p_workspace jsonb,
  p_camel_key text,
  p_snake_key text,
  p_range_day_id text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
  from jsonb_array_elements(public.range_workspace_collection(p_workspace, p_camel_key, p_snake_key))
    with ordinality as item(value, ordinality)
  where coalesce(item.value ->> 'rangeDayId', item.value ->> 'range_day_id') = p_range_day_id
$$;

create or replace function public.protect_pilot_range_workspace_mutation()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  old_day jsonb;
  next_day jsonb;
  day_id text;
  is_manager boolean;
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;

  is_manager := public.has_any_department_permission(
    old.department_id,
    array['manage_range_days', 'administer_department']
  );

  if not is_manager and not public.has_any_department_permission(
    old.department_id,
    array['score_range_days', 'manage_qualifications']
  ) then
    raise exception using errcode = '42501', message = 'Range record management permission is required.';
  end if;

  if new.department_id is distinct from old.department_id then
    raise exception using errcode = '42501', message = 'Range workspace agency ownership cannot be changed.';
  end if;

  if not is_manager and (
    public.range_workspace_collection(old.workspace, 'rangeDays', 'range_days') is distinct from public.range_workspace_collection(new.workspace, 'rangeDays', 'range_days')
    or public.range_workspace_collection(old.workspace, 'drillLibrary', 'drill_library') is distinct from public.range_workspace_collection(new.workspace, 'drillLibrary', 'drill_library')
    or public.range_workspace_collection(old.workspace, 'rangeDayDrills', 'range_day_drills') is distinct from public.range_workspace_collection(new.workspace, 'rangeDayDrills', 'range_day_drills')
    or public.range_workspace_collection(old.workspace, 'rangeRoster', 'range_roster') is distinct from public.range_workspace_collection(new.workspace, 'rangeRoster', 'range_roster')
  ) then
    raise exception using errcode = '42501', message = 'Range-day planning changes require range management permission.';
  end if;

  for old_day in
    select value from jsonb_array_elements(public.range_workspace_collection(old.workspace, 'rangeDays', 'range_days'))
    where lower(coalesce(value ->> 'status', '')) in ('completed', 'locked', 'archived')
       or lower(coalesce(value ->> 'packetStatus', value ->> 'packet_status', '')) = 'ready'
  loop
    day_id := old_day ->> 'id';
    select value into next_day
    from jsonb_array_elements(public.range_workspace_collection(new.workspace, 'rangeDays', 'range_days'))
    where value ->> 'id' = day_id
    limit 1;

    if next_day is distinct from old_day
      or public.range_workspace_day_items(old.workspace, 'rangeDayDrills', 'range_day_drills', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'rangeDayDrills', 'range_day_drills', day_id)
      or public.range_workspace_day_items(old.workspace, 'rangeRoster', 'range_roster', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'rangeRoster', 'range_roster', day_id)
      or public.range_workspace_day_items(old.workspace, 'results', 'drill_run_results', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'results', 'drill_run_results', day_id)
      or public.range_workspace_day_items(old.workspace, 'malfunctions', 'firearm_malfunctions', day_id) is distinct from public.range_workspace_day_items(new.workspace, 'malfunctions', 'firearm_malfunctions', day_id)
    then
      raise exception using errcode = '23514', message = 'Finalized range history cannot be changed.';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists pilot_range_workspaces_protect_mutation on public.pilot_range_workspaces;
create trigger pilot_range_workspaces_protect_mutation
before update on public.pilot_range_workspaces
for each row execute function public.protect_pilot_range_workspace_mutation();

-- Fleet reads and writes use the same department permission matrix as the API.
-- Service-role API calls still perform their own resolved-user authorization.
drop policy if exists "fleet_vehicles_select_scoped" on public.fleet_vehicles;
drop policy if exists "fleet_vehicles_insert_managers" on public.fleet_vehicles;
drop policy if exists "fleet_vehicles_update_managers" on public.fleet_vehicles;
drop policy if exists "fleet_vehicles_delete_admins" on public.fleet_vehicles;

create policy "fleet_vehicles_select_scoped"
on public.fleet_vehicles for select to authenticated
using (
  public.is_active_department_member(department_id, auth.uid())
  and public.has_any_department_permission(
    department_id,
    array['view_fleet', 'manage_fleet', 'perform_fleet_inspections', 'manage_fleet_maintenance', 'manage_fleet_rules', 'administer_department']
  )
);

create policy "fleet_vehicles_insert_managers"
on public.fleet_vehicles for insert to authenticated
with check (public.has_any_department_permission(department_id, array['manage_fleet', 'administer_department']));

create policy "fleet_vehicles_update_managers"
on public.fleet_vehicles for update to authenticated
using (public.has_any_department_permission(department_id, array['manage_fleet', 'administer_department']))
with check (public.has_any_department_permission(department_id, array['manage_fleet', 'administer_department']));

create policy "fleet_vehicles_delete_admins"
on public.fleet_vehicles for delete to authenticated
using (public.has_department_permission(department_id, 'administer_department'));

-- Generic database auditing covers direct RLS writes; API writes also include
-- their required human-entered reason in a second, descriptive audit event.
drop trigger if exists fleet_vehicles_accountability_audit on public.fleet_vehicles;
create trigger fleet_vehicles_accountability_audit
after insert or update or delete on public.fleet_vehicles
for each row execute function public.write_audit_event();

drop trigger if exists pilot_range_workspaces_accountability_audit on public.pilot_range_workspaces;
create trigger pilot_range_workspaces_accountability_audit
after insert or update or delete on public.pilot_range_workspaces
for each row execute function public.write_audit_event();

commit;
