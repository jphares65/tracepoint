-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers database/aws/046's
-- outbox delivery: an inspection that an older image already audited itself
-- (as after an image rollback) is not audited a second time, through either
-- the request's delivery or the reconciliation; an inspection audited only
-- through the outbox still gets exactly one row.
begin;
insert into auth.users(id,email) values
 ('0f460000-0000-4000-8000-0000000000a1','fo-inspector@example.invalid'),
 ('0f460000-0000-4000-8000-0000000000a2','fo-manager@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'fo-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values ('0f460000-0000-4000-8000-00000000000a','FO tenant A','local-fo-a');
delete from public.department_role_permissions where department_id='0f460000-0000-4000-8000-00000000000a';
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000000a1',true),
 ('0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000000a2',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000000a1','officer'),
 ('0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000000a2','command_staff');
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0f460000-0000-4000-8000-00000000000a','officer','perform_fleet_inspections'),
 ('0f460000-0000-4000-8000-00000000000a','command_staff','manage_fleet');
insert into public.fleet_vehicles(id,department_id,unit_number,status) values
 ('0f460000-0000-4000-8000-0000000001e1','0f460000-0000-4000-8000-00000000000a','FO-1','Available');
-- Four inspections, each queued by the 043 trigger: 1 and 4 also audited
-- directly in the previous image's shape (auditFleet), 2 and 3 not.
insert into public.fleet_vehicle_inspections(id,department_id,vehicle_id,result,inspector_user_id) values
 ('0f460000-0000-4000-8000-0000000002a1','0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000001e1','Passed','0f460000-0000-4000-8000-0000000000a1'),
 ('0f460000-0000-4000-8000-0000000002a2','0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000001e1','Passed','0f460000-0000-4000-8000-0000000000a1'),
 ('0f460000-0000-4000-8000-0000000002a3','0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000001e1','Passed','0f460000-0000-4000-8000-0000000000a1'),
 ('0f460000-0000-4000-8000-0000000002a4','0f460000-0000-4000-8000-00000000000a','0f460000-0000-4000-8000-0000000001e1','Passed','0f460000-0000-4000-8000-0000000000a1');
-- Reconciliation takes entries over five minutes old.
update public.fleet_audit_outbox set created_at = now() - interval '10 minutes'
where inspection_id in ('0f460000-0000-4000-8000-0000000002a1','0f460000-0000-4000-8000-0000000002a2');

set local session authorization tracepoint_runtime;
set local role authenticated;
select set_config('tracepoint.subject_id','0f460000-0000-4000-8000-0000000000a1',true), set_config('tracepoint.department_id','0f460000-0000-4000-8000-00000000000a',true);
insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,details)
select i.department_id, i.inspector_user_id, 'fleet_vehicle_inspected', 'fleet_vehicle', i.vehicle_id,
  jsonb_build_object('inspection', to_jsonb(i), 'work_order_id', null, 'support_mode', false)
from public.fleet_vehicle_inspections i
where i.id in ('0f460000-0000-4000-8000-0000000002a1','0f460000-0000-4000-8000-0000000002a4');

-- The new image: the manager's fleet-list reconciliation, then each request's delivery, twice.
select set_config('tracepoint.subject_id','0f460000-0000-4000-8000-0000000000a2',true);
do $$
declare result jsonb; first bigint; again bigint; inspection uuid;
begin
 result := public.deliver_pending_fleet_audit('0f460000-0000-4000-8000-00000000000a');
 if (result->>'delivered')::int <> 2 or (result->>'failed')::int <> 0 then
  raise exception 'Fleet audit reconciliation returned %', result;
 end if;
 foreach inspection in array array['0f460000-0000-4000-8000-0000000002a3','0f460000-0000-4000-8000-0000000002a4']::uuid[] loop
  first := public.deliver_fleet_audit_outbox(inspection, jsonb_build_object('work_order_id', null));
  again := public.deliver_fleet_audit_outbox(inspection, '{}'::jsonb);
  if first is null or again is distinct from first then
   raise exception 'Fleet audit delivery for % returned % then %', inspection, first, again;
  end if;
 end loop;
end $$;
reset role;
reset session authorization;

do $$
declare row record;
begin
 for row in
  select o.inspection_id, o.delivered_at, o.audit_event_id, o.delivered_by_existing_audit,
    (select count(*) from public.audit_events e where e.action='fleet_vehicle_inspected'
       and e.details->'inspection'->>'id' = o.inspection_id::text) as audits,
    (select e.id from public.audit_events e where e.action='fleet_vehicle_inspected'
       and e.details->'inspection'->>'id' = o.inspection_id::text order by e.id limit 1) as event_id,
    o.inspection_id in ('0f460000-0000-4000-8000-0000000002a1','0f460000-0000-4000-8000-0000000002a4') as audited_directly
  from public.fleet_audit_outbox o
  where o.department_id = '0f460000-0000-4000-8000-00000000000a'
 loop
  if row.delivered_at is null or row.audits <> 1 or row.audit_event_id is distinct from row.event_id
     or row.delivered_by_existing_audit is distinct from row.audited_directly then
   raise exception 'Fleet audit outbox entry %: % audit rows, delivered %, linked %, by existing audit %',
     row.inspection_id, row.audits, row.delivered_at, row.audit_event_id, row.delivered_by_existing_audit;
  end if;
 end loop;
 if (select count(*) from public.fleet_audit_outbox where department_id='0f460000-0000-4000-8000-00000000000a') <> 4 then
  raise exception 'Expected four queued fleet audit entries';
 end if;
end $$;
rollback;
