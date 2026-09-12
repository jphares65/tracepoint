begin;

-- These tables were created after the source lineage's blanket authenticated
-- grants. RLS remains the authorization boundary; the SQL role privileges only
-- allow overlay 018's tenant- and permission-bound policies to be evaluated.
grant select, insert, update, delete on table
  public.fleet_rules,
  public.fleet_vehicles,
  public.fleet_work_orders,
  public.fleet_vehicle_equipment,
  public.fleet_vehicle_documents
to authenticated;

grant select, insert on table
  public.fleet_vehicle_inspections
to authenticated;

grant select, insert, update, delete on table
  public.off_duty_firearm_requests
to authenticated;

grant select, insert on table
  public.off_duty_firearm_history
to authenticated;

commit;
