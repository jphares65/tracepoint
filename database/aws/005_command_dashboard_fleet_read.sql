begin;

drop policy if exists "fleet_vehicles_select_scoped" on public.fleet_vehicles;
create policy "fleet_vehicles_select_scoped"
on public.fleet_vehicles for select to authenticated
using (
  public.is_active_department_member(department_id, tracepoint_auth.subject_id())
  and public.has_any_department_permission(
    department_id,
    array[
      'view_command_dashboard',
      'view_fleet',
      'manage_fleet',
      'perform_fleet_inspections',
      'manage_fleet_maintenance',
      'manage_fleet_rules',
      'administer_department'
    ]
  )
);

commit;
