begin;

-- Fleet V1 enabled RLS without defining policies. The hosted service-role
-- bridge masked that omission; the AWS runtime intentionally assumes the
-- authenticated role, so every access must be tenant- and permission-bound.
create policy fleet_rules_read
on public.fleet_rules for select to authenticated
using (
  public.has_department_permission(department_id, 'view_fleet')
  or public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'perform_fleet_inspections')
  or public.has_department_permission(department_id, 'manage_fleet_maintenance')
  or public.has_department_permission(department_id, 'manage_fleet_rules')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_rules_manage
on public.fleet_rules for all to authenticated
using (
  public.has_department_permission(department_id, 'manage_fleet_rules')
  or public.has_department_permission(department_id, 'administer_department')
)
with check (
  public.has_department_permission(department_id, 'manage_fleet_rules')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_vehicles_read
on public.fleet_vehicles for select to authenticated
using (
  public.has_department_permission(department_id, 'view_fleet')
  or public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'perform_fleet_inspections')
  or public.has_department_permission(department_id, 'manage_fleet_maintenance')
  or public.has_department_permission(department_id, 'manage_fleet_rules')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_vehicles_manage
on public.fleet_vehicles for all to authenticated
using (
  public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
)
with check (
  public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_work_orders_read
on public.fleet_work_orders for select to authenticated
using (
  public.has_department_permission(department_id, 'view_fleet')
  or public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'manage_fleet_maintenance')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_work_orders_manage
on public.fleet_work_orders for all to authenticated
using (
  public.has_department_permission(department_id, 'manage_fleet_maintenance')
  or public.has_department_permission(department_id, 'administer_department')
)
with check (
  public.has_department_permission(department_id, 'manage_fleet_maintenance')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_equipment_read
on public.fleet_vehicle_equipment for select to authenticated
using (
  public.has_department_permission(department_id, 'view_fleet')
  or public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'perform_fleet_inspections')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_equipment_manage
on public.fleet_vehicle_equipment for all to authenticated
using (
  public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
)
with check (
  public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_documents_read
on public.fleet_vehicle_documents for select to authenticated
using (
  public.has_department_permission(department_id, 'view_fleet')
  or public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_documents_manage
on public.fleet_vehicle_documents for all to authenticated
using (
  public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
)
with check (
  public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_inspections_read
on public.fleet_vehicle_inspections for select to authenticated
using (
  public.has_department_permission(department_id, 'view_fleet')
  or public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'perform_fleet_inspections')
  or public.has_department_permission(department_id, 'administer_department')
);

create policy fleet_inspections_insert
on public.fleet_vehicle_inspections for insert to authenticated
with check (
  public.has_department_permission(department_id, 'perform_fleet_inspections')
  or public.has_department_permission(department_id, 'manage_fleet')
  or public.has_department_permission(department_id, 'administer_department')
);

-- The replacement off-duty history table also enabled RLS without policies.
-- Officers may see and append history only for their own requests; reviewers
-- retain the department-wide command workflow.
create policy off_duty_history_read
on public.off_duty_firearm_history for select to authenticated
using (
  public.has_department_permission(department_id, 'review_off_duty_requests')
  or exists (
    select 1 from public.off_duty_firearm_requests request
    where request.id = off_duty_firearm_history.request_id
      and request.department_id = off_duty_firearm_history.department_id
      and request.officer_user_id = tracepoint_auth.subject_id()
  )
);

create policy off_duty_history_insert
on public.off_duty_firearm_history for insert to authenticated
with check (
  actor_user_id = tracepoint_auth.subject_id()
  and (
    public.has_department_permission(department_id, 'review_off_duty_requests')
    or (
      public.has_department_permission(department_id, 'submit_off_duty_requests')
      and exists (
        select 1 from public.off_duty_firearm_requests request
        where request.id = off_duty_firearm_history.request_id
          and request.department_id = off_duty_firearm_history.department_id
          and request.officer_user_id = tracepoint_auth.subject_id()
      )
    )
  )
);

commit;
