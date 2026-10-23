begin;

-- AT-1 (staging acceptance 2026-10-22): a manual Available on a vehicle under a safety
-- hold was answered 200. The 057 guard kept the status Out of Service but let the same
-- update save status_override_active and status_reason, so after the hold was cleared,
-- the work orders completed and a clean inspection passed, the leftover override still
-- kept the vehicle Out of Service.
--
-- A person's status change is now refused whole while a hold applies (SQLSTATE 55000),
-- whichever route, page state or request ordering sent it: nothing of that update is
-- written, and the refusal is audited. A manual change is one that sets or changes the
-- override (both manual-status routes write status_override_active; automatic readiness
-- updates write only status). Automatic updates keep 057's behaviour: the status is kept
-- Out of Service and audited.

create or replace function public.guard_fleet_safety_hold_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
declare
  v_since timestamptz;
  v_open boolean;
  v_manual boolean;
begin
  if coalesce(new.status, '') not in ('Available', 'Attention') then
    return new;
  end if;
  select max(c.created_at) into v_since from (
    select i.created_at from public.fleet_vehicle_inspections i
    where i.department_id = old.department_id and i.vehicle_id = old.id and i.critical_defect_count > 0
    union all
    select w.created_at from public.fleet_work_orders w
    where w.department_id = old.department_id and w.vehicle_id = old.id and (w.priority = 'Critical' or w.affects_availability)) c;
  if v_since is null then
    return new;
  end if;
  v_open := exists (select 1 from public.fleet_work_orders w
    where w.department_id = old.department_id and w.vehicle_id = old.id
      and w.status not in ('Completed', 'Cancelled')
      and (w.priority = 'Critical' or w.affects_availability));
  if not v_open
     and (new.safety_hold_cleared_at > v_since
          or exists (select 1 from public.fleet_vehicle_inspections i
                     where i.department_id = old.department_id and i.vehicle_id = old.id
                       and i.critical_defect_count = 0 and i.created_at > v_since)) then
    return new;
  end if;
  v_manual := new.status_override_active is distinct from old.status_override_active
    or (coalesce(new.status_override_active, false) and new.status is distinct from old.status);
  if v_manual then
    -- Nothing of this update is written; the route records the refusal.
    raise exception 'fleet safety hold active' using errcode = '55000';
  end if;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, details)
  values (old.department_id, tracepoint_auth.subject_id(), 'fleet_safety_hold_status_kept', 'fleet_vehicle', old.id,
    'Vehicle kept Out of Service: a critical safety hold is active.',
    jsonb_build_object('attempted_status', new.status, 'previous_status', old.status, 'status', 'Out of Service',
      'hold', jsonb_build_object('since', v_since, 'open_critical_work_order', v_open),
      'support_mode', tracepoint_auth.is_platform_supporting(old.department_id)));
  new.status := 'Out of Service';
  return new;
end;
$$;

revoke all on function public.guard_fleet_safety_hold_status() from public, anon, authenticated, service_role;

-- Vehicles the defect already left with an override that a hold kept Out of Service.
-- Correcting them is a manager's decision (the reason they gave may still apply), so they
-- are reported to the audit log for review, not changed.
insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, details)
select v.department_id, null, 'fleet_status_override_review', 'fleet_vehicle', v.id,
  'Review: a manual status override was saved while a safety hold kept this vehicle Out of Service (AT-1).',
  jsonb_build_object('migration', '068', 'status', v.status, 'status_reason', v.status_reason)
from public.fleet_vehicles v
where v.status_override_active and v.status = 'Out of Service'
  and exists (select 1 from public.audit_events a
              where a.department_id = v.department_id and a.entity_type = 'fleet_vehicle' and a.entity_id = v.id
                and a.action = 'fleet_safety_hold_status_kept' and a.details->>'attempted_status' in ('Available', 'Attention'))
  and not exists (select 1 from public.audit_events a
                  where a.entity_id = v.id and a.action = 'fleet_status_override_review');

commit;
