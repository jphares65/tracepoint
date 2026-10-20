begin;

-- One vehicle inspection eligibility rule for the API and the database (F2).
-- The inspection route admitted fleet_rules.inspection_role_codes holders, and
-- everyone when that list was empty, while RLS keyed only on
-- perform_fleet_inspections. An active member is eligible with manage_fleet,
-- administer_department or perform_fleet_inspections; otherwise, when the agency
-- lists inspection roles, by holding one of them, and when it lists none, by
-- having Fleet access (view_fleet).
-- Mirrored by canSubmitFleetInspection in src/lib/tracepoint/fleet-server.ts.
create or replace function public.can_submit_fleet_inspection(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.is_active_department_member(p_department_id, tracepoint_auth.subject_id())
    and (
      public.has_any_department_permission(p_department_id, array['manage_fleet', 'administer_department', 'perform_fleet_inspections'])
      or case
        when coalesce(cardinality(rules.inspection_role_codes), 0) > 0 then exists (
          select 1 from public.department_memberships membership
          join public.department_membership_roles membership_role
            on membership_role.department_id = membership.department_id and membership_role.user_id = membership.user_id
          where membership.department_id = p_department_id
            and membership.user_id = tracepoint_auth.subject_id()
            and membership.is_active
            and membership_role.role_code = any(rules.inspection_role_codes)
        )
        else public.has_department_permission(p_department_id, 'view_fleet')
      end
    )
  from (select (select fleet_rules.inspection_role_codes from public.fleet_rules where fleet_rules.department_id = p_department_id) as inspection_role_codes) rules
$$;

revoke all on function public.can_submit_fleet_inspection(uuid) from public, anon, service_role;
grant execute on function public.can_submit_fleet_inspection(uuid) to authenticated;

-- Eligible inspectors read the rules, vehicles, equipment and inspections the
-- inspection and issue routes and the readiness refresh read.
drop policy if exists fleet_rules_read_inspection_eligible on public.fleet_rules;
create policy fleet_rules_read_inspection_eligible
on public.fleet_rules for select to authenticated
using (department_id = tracepoint_auth.department_id() and public.can_submit_fleet_inspection(department_id));

drop policy if exists fleet_vehicles_read_inspection_eligible on public.fleet_vehicles;
create policy fleet_vehicles_read_inspection_eligible
on public.fleet_vehicles for select to authenticated
using (department_id = tracepoint_auth.department_id() and public.can_submit_fleet_inspection(department_id));

drop policy if exists fleet_equipment_read_inspection_eligible on public.fleet_vehicle_equipment;
create policy fleet_equipment_read_inspection_eligible
on public.fleet_vehicle_equipment for select to authenticated
using (department_id = tracepoint_auth.department_id() and public.can_submit_fleet_inspection(department_id));

drop policy if exists fleet_inspections_read_inspection_eligible on public.fleet_vehicle_inspections;
create policy fleet_inspections_read_inspection_eligible
on public.fleet_vehicle_inspections for select to authenticated
using (department_id = tracepoint_auth.department_id() and public.can_submit_fleet_inspection(department_id));

drop policy if exists fleet_inspections_insert_inspection_eligible on public.fleet_vehicle_inspections;
create policy fleet_inspections_insert_inspection_eligible
on public.fleet_vehicle_inspections for insert to authenticated
with check (
  department_id = tracepoint_auth.department_id()
  and public.can_submit_fleet_inspection(department_id)
  and inspector_user_id = tracepoint_auth.subject_id()
  and exists (
    select 1 from public.fleet_vehicles vehicle
    where vehicle.id = fleet_vehicle_inspections.vehicle_id
      and vehicle.department_id = fleet_vehicle_inspections.department_id
  )
);

-- The 040 field-workflow grants follow the same rule.
drop policy if exists audit_events_insert_fleet on public.audit_events;
create policy audit_events_insert_fleet
on public.audit_events for insert to authenticated
with check (
  actor_user_id = tracepoint_auth.subject_id()
  and department_id = tracepoint_auth.department_id()
  and action like 'fleet\_%'
  and entity_type in ('fleet_vehicle', 'fleet_rules')
  and (
    public.has_any_department_permission(department_id, array['manage_fleet', 'manage_fleet_maintenance', 'manage_fleet_rules'])
    or public.can_submit_fleet_inspection(department_id)
  )
);

drop policy if exists fleet_work_orders_read_inspectors on public.fleet_work_orders;
create policy fleet_work_orders_read_inspectors
on public.fleet_work_orders for select to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and public.can_submit_fleet_inspection(department_id)
);

-- Inspection defects and reported issues: open, self-authored, unassigned, and
-- without schedule, cost, resolution or completion.
drop policy if exists fleet_work_orders_insert_inspection_defects on public.fleet_work_orders;
create policy fleet_work_orders_insert_inspection_defects
on public.fleet_work_orders for insert to authenticated
with check (
  department_id = tracepoint_auth.department_id()
  and public.can_submit_fleet_inspection(department_id)
  and record_type in ('Inspection', 'Issue')
  and status = 'Open'
  and created_by_user_id = tracepoint_auth.subject_id()
  and updated_by_user_id = tracepoint_auth.subject_id()
  and assigned_user_id is null and mechanic_name is null and vendor is null
  and scheduled_for is null and due_date is null
  and started_at is null and completed_at is null and returned_to_service_at is null
  and labor_cost is null and parts_cost is null and total_cost is null and resolution is null
  and exists (
    select 1 from public.fleet_vehicles vehicle
    where vehicle.id = fleet_work_orders.vehicle_id
      and vehicle.department_id = fleet_work_orders.department_id
  )
);

drop policy if exists fleet_equipment_update_inspectors on public.fleet_vehicle_equipment;
create policy fleet_equipment_update_inspectors
on public.fleet_vehicle_equipment for update to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and public.can_submit_fleet_inspection(department_id)
)
with check (
  department_id = tracepoint_auth.department_id()
  and public.can_submit_fleet_inspection(department_id)
);

drop policy if exists fleet_vehicles_update_field_workflows on public.fleet_vehicles;
create policy fleet_vehicles_update_field_workflows
on public.fleet_vehicles for update to authenticated
using (
  department_id = tracepoint_auth.department_id()
  and (public.can_submit_fleet_inspection(department_id) or public.has_department_permission(department_id, 'manage_fleet_maintenance'))
)
with check (
  department_id = tracepoint_auth.department_id()
  and (public.can_submit_fleet_inspection(department_id) or public.has_department_permission(department_id, 'manage_fleet_maintenance'))
);

-- The 040 guard, with the inspector branch keyed on the same rule.
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
  v_inspector := public.can_submit_fleet_inspection(old.department_id);
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

commit;
