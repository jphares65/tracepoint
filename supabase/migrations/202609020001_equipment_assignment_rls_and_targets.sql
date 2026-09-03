begin;

-- The custody-history trigger runs with the caller's privileges.  This table had
-- RLS enabled without policies, so an assigned asset insert/update was rejected
-- when the trigger attempted to INSERT/UPDATE its history row.
drop policy if exists "equipment_assignment_history_select_scoped" on public.equipment_asset_assignments;
drop policy if exists "equipment_assignment_history_insert_managers" on public.equipment_asset_assignments;
drop policy if exists "equipment_assignment_history_update_managers" on public.equipment_asset_assignments;

create policy "equipment_assignment_history_select_scoped"
on public.equipment_asset_assignments for select to authenticated
using (
  public.is_active_department_member(department_id, auth.uid())
  and (
    assigned_user_id = auth.uid()
    or public.has_any_department_permission(
      department_id, array['manage_equipment', 'administer_department']
    )
  )
);

create policy "equipment_assignment_history_insert_managers"
on public.equipment_asset_assignments for insert to authenticated
with check (
  public.has_any_department_permission(
    department_id, array['manage_equipment', 'administer_department']
  )
  and exists (
    select 1 from public.equipment_assets asset
    where asset.id = equipment_asset_id
      and asset.department_id = equipment_asset_assignments.department_id
  )
  and exists (
    select 1 from public.department_memberships member
    where member.department_id = equipment_asset_assignments.department_id
      and member.user_id = equipment_asset_assignments.assigned_user_id
      and member.is_active = true
  )
);

create policy "equipment_assignment_history_update_managers"
on public.equipment_asset_assignments for update to authenticated
using (
  public.has_any_department_permission(
    department_id, array['manage_equipment', 'administer_department']
  )
)
with check (
  public.has_any_department_permission(
    department_id, array['manage_equipment', 'administer_department']
  )
);

-- Current custody supports one target. Officer custody continues to be mirrored
-- into equipment_asset_assignments; vehicle/location custody lives on the asset.
alter table public.equipment_assets
  add column if not exists assigned_vehicle_id uuid,
  add column if not exists assigned_location text,
  add column if not exists asset_number text;

create index if not exists equipment_assets_department_vehicle_idx
  on public.equipment_assets(department_id, assigned_vehicle_id)
  where assigned_vehicle_id is not null;

create unique index if not exists equipment_assets_department_asset_number_unique
  on public.equipment_assets(department_id, lower(asset_number))
  where asset_number is not null and btrim(asset_number) <> '';

do $$
begin
  if to_regclass('public.fleet_vehicles') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'equipment_assets_assigned_vehicle_same_department_fkey'
         and conrelid = 'public.equipment_assets'::regclass
     ) then
    create unique index if not exists fleet_vehicles_id_department_unique
      on public.fleet_vehicles(id, department_id);
    alter table public.equipment_assets
      add constraint equipment_assets_assigned_vehicle_same_department_fkey
      foreign key (assigned_vehicle_id, department_id)
      references public.fleet_vehicles(id, department_id)
      on delete restrict;
  end if;
end $$;

alter table public.equipment_assets
  drop constraint if exists equipment_assets_single_assignment_target;

alter table public.equipment_assets
  add constraint equipment_assets_single_assignment_target check (
    num_nonnulls(assigned_user_id, assigned_vehicle_id, nullif(btrim(assigned_location), '')) <= 1
  );

-- Enforce same-tenant active personnel even if a future caller bypasses the API.
create or replace function public.validate_equipment_asset_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'UPDATE' and new.department_id is distinct from old.department_id then
    raise exception using
      errcode = '23514',
      message = 'Equipment agency ownership cannot be changed.';
  end if;

  if new.assigned_user_id is not null and not exists (
    select 1 from public.department_memberships member
    where member.department_id = new.department_id
      and member.user_id = new.assigned_user_id
      and member.is_active = true
  ) then
    raise exception using
      errcode = '23514',
      message = 'Assigned officer must be an active member of the equipment agency.';
  end if;

  if new.assigned_vehicle_id is not null and not exists (
    select 1 from public.fleet_vehicles vehicle
    where vehicle.department_id = new.department_id
      and vehicle.id = new.assigned_vehicle_id
      and vehicle.status <> 'Retired'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Assigned vehicle must belong to the equipment agency.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_equipment_asset_assignment() from public;
grant execute on function public.validate_equipment_asset_assignment() to authenticated;

drop trigger if exists trg_equipment_asset_validate_assignment on public.equipment_assets;
create trigger trg_equipment_asset_validate_assignment
before insert or update of department_id, assigned_user_id, assigned_vehicle_id, assigned_location
on public.equipment_assets
for each row execute function public.validate_equipment_asset_assignment();

-- Add history auditing as well as the existing asset audit. write_audit_event
-- records actor, full previous/new values, and timestamp in audit_events.
drop trigger if exists equipment_asset_assignments_accountability_audit
  on public.equipment_asset_assignments;
create trigger equipment_asset_assignments_accountability_audit
after insert or update or delete on public.equipment_asset_assignments
for each row execute function public.write_audit_event();

commit;
