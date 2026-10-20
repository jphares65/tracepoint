begin;

-- The AWS runtime executes route writes as the subject. Inspectors, mechanics
-- and fleet managers without administer_department therefore lost the side
-- effects the fleet routes already authorize (NEW-01). Grant only those writes,
-- bound to the session agency, and keep general fleet editing with manage_fleet.

-- Fleet route audit records (auditFleet and the vehicle routes).
drop policy if exists audit_events_insert_fleet on public.audit_events;
create policy audit_events_insert_fleet
on public.audit_events for insert to authenticated
with check (
  actor_user_id = tracepoint_auth.subject_id()
  and department_id = tracepoint_auth.department_id()
  and action like 'fleet\_%'
  and entity_type in ('fleet_vehicle', 'fleet_rules')
  and public.has_any_department_permission(
    department_id,
    array['manage_fleet', 'manage_fleet_maintenance', 'manage_fleet_rules', 'perform_fleet_inspections']
  )
);

-- Inspectors read work orders so the inspection response and status refresh
-- see the vehicle's open defects, and may open the inspection defect record.
drop policy if exists fleet_work_orders_read_inspectors on public.fleet_work_orders;
create policy fleet_work_orders_read_inspectors
on public.fleet_work_orders for select to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and public.has_department_permission(department_id, 'perform_fleet_inspections')
);

drop policy if exists fleet_work_orders_insert_inspection_defects on public.fleet_work_orders;
create policy fleet_work_orders_insert_inspection_defects
on public.fleet_work_orders for insert to authenticated
with check (
  department_id = tracepoint_auth.department_id()
  and public.has_department_permission(department_id, 'perform_fleet_inspections')
  and record_type = 'Inspection'
  and status = 'Open'
  and created_by_user_id = tracepoint_auth.subject_id()
  and updated_by_user_id = tracepoint_auth.subject_id()
  and assigned_user_id is null and mechanic_name is null and vendor is null
  and started_at is null and completed_at is null and returned_to_service_at is null
  and labor_cost is null and parts_cost is null and total_cost is null and resolution is null
  and exists (
    select 1 from public.fleet_vehicles vehicle
    where vehicle.id = fleet_work_orders.vehicle_id
      and vehicle.department_id = fleet_work_orders.department_id
  )
);

-- Inspectors record the inspected condition of required vehicle equipment.
drop policy if exists fleet_equipment_update_inspectors on public.fleet_vehicle_equipment;
create policy fleet_equipment_update_inspectors
on public.fleet_vehicle_equipment for update to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and public.has_department_permission(department_id, 'perform_fleet_inspections')
)
with check (
  department_id = tracepoint_auth.department_id()
  and public.has_department_permission(department_id, 'perform_fleet_inspections')
);

-- Inspectors and mechanics update the readings, due dates and automated
-- readiness status their workflows maintain. Column limits are in the guard.
drop policy if exists fleet_vehicles_update_field_workflows on public.fleet_vehicles;
create policy fleet_vehicles_update_field_workflows
on public.fleet_vehicles for update to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and public.has_any_department_permission(department_id, array['perform_fleet_inspections', 'manage_fleet_maintenance'])
)
with check (
  department_id = tracepoint_auth.department_id()
  and public.has_any_department_permission(department_id, array['perform_fleet_inspections', 'manage_fleet_maintenance'])
);

-- Row policies cannot limit columns, so subjects without manage_fleet may only
-- change the fields their workflow writes.
create or replace function public.guard_fleet_field_vehicle_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_inspector boolean;
  v_maintainer boolean;
  v_allowed text[] := array['status', 'open_issue_count', 'updated_at', 'updated_by_user_id'];
  v_changed text[];
  v_takes_out_of_service boolean;
begin
  if current_user <> 'authenticated'
     or public.has_any_department_permission(old.department_id, array['manage_fleet', 'administer_department']) then
    return new;
  end if;
  v_inspector := public.has_department_permission(old.department_id, 'perform_fleet_inspections');
  v_maintainer := public.has_department_permission(old.department_id, 'manage_fleet_maintenance');
  if v_inspector then
    v_allowed := v_allowed || array['current_mileage', 'current_hours', 'inspection_due_date'];
  end if;
  if v_maintainer then
    v_allowed := v_allowed || array['current_mileage', 'current_hours', 'last_service_date', 'last_service_mileage',
      'last_service_hours', 'next_service_date', 'next_service_mileage', 'next_service_hours'];
  end if;
  -- A manual override never masks a critical defect: the field workflow may
  -- still take an overridden Available/Attention vehicle out of service, with
  -- its reason, but may not make it more available.
  v_takes_out_of_service := new.status = 'Out of Service' and old.status in ('Available', 'Attention');
  if v_takes_out_of_service then
    v_allowed := v_allowed || array['status_reason'];
  end if;
  select coalesce(array_agg(field.key), array[]::text[]) into v_changed
  from jsonb_each(to_jsonb(new)) field
  where field.value is distinct from to_jsonb(old) -> field.key;
  if not v_changed <@ v_allowed
     or (new.updated_by_user_id is distinct from old.updated_by_user_id
         and new.updated_by_user_id is distinct from tracepoint_auth.subject_id())
     or (new.status is distinct from old.status
         and (old.status = 'Retired' or (old.status_override_active and not v_takes_out_of_service)
              or new.status not in ('Available', 'Attention', 'Maintenance', 'Out of Service')))
     or (not v_maintainer and (new.current_mileage < old.current_mileage or new.current_hours < old.current_hours)) then
    raise exception 'fleet vehicle change forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists fleet_vehicles_field_update_guard on public.fleet_vehicles;
create trigger fleet_vehicles_field_update_guard
before update on public.fleet_vehicles
for each row execute function public.guard_fleet_field_vehicle_update();

create or replace function public.guard_fleet_field_equipment_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_changed text[];
begin
  if current_user <> 'authenticated'
     or public.has_any_department_permission(old.department_id, array['manage_fleet', 'administer_department']) then
    return new;
  end if;
  select coalesce(array_agg(field.key), array[]::text[]) into v_changed
  from jsonb_each(to_jsonb(new)) field
  where field.value is distinct from to_jsonb(old) -> field.key;
  if not v_changed <@ array['status', 'updated_at', 'updated_by_user_id']
     or old.status = 'Removed'
     or new.status not in ('Current', 'Attention', 'Out of Service')
     or (new.updated_by_user_id is distinct from old.updated_by_user_id
         and new.updated_by_user_id is distinct from tracepoint_auth.subject_id()) then
    raise exception 'fleet equipment change forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists fleet_vehicle_equipment_field_update_guard on public.fleet_vehicle_equipment;
create trigger fleet_vehicle_equipment_field_update_guard
before update on public.fleet_vehicle_equipment
for each row execute function public.guard_fleet_field_equipment_update();

commit;
