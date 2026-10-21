-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers database/aws/046's
-- status guard: the writes an older image makes after completing a held
-- vehicle's critical work order (its readiness refresh, a manager's override)
-- succeed but keep the vehicle Out of Service, with an audit row by the
-- writer; a later inspection without critical defects or a manager clearance
-- with a reason still releases it, and vehicles without a hold are unaffected.
begin;
insert into auth.users(id,email) values
 ('0f470000-0000-4000-8000-0000000000a1','hr-inspector@example.invalid'),
 ('0f470000-0000-4000-8000-0000000000a2','hr-mechanic@example.invalid'),
 ('0f470000-0000-4000-8000-0000000000a3','hr-manager@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'hr-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values ('0f470000-0000-4000-8000-00000000000a','HR tenant A','local-hr-a');
delete from public.department_role_permissions where department_id='0f470000-0000-4000-8000-00000000000a';
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000000a1',true),
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000000a2',true),
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000000a3',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000000a1','officer'),
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000000a2','mechanic'),
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000000a3','command_staff');
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0f470000-0000-4000-8000-00000000000a','officer','perform_fleet_inspections'),
 ('0f470000-0000-4000-8000-00000000000a','mechanic','manage_fleet_maintenance'),
 ('0f470000-0000-4000-8000-00000000000a','command_staff','manage_fleet');
-- 1: critical inspection and its open Critical work order; 2: critical
-- inspection, work order already completed; 3: no critical history; 4: open
-- critical work order with a later passing inspection.
insert into public.fleet_vehicles(id,department_id,unit_number,status) values
 ('0f470000-0000-4000-8000-0000000001e1','0f470000-0000-4000-8000-00000000000a','HR-1','Available'),
 ('0f470000-0000-4000-8000-0000000001e2','0f470000-0000-4000-8000-00000000000a','HR-2','Available'),
 ('0f470000-0000-4000-8000-0000000001e3','0f470000-0000-4000-8000-00000000000a','HR-3','Available'),
 ('0f470000-0000-4000-8000-0000000001e4','0f470000-0000-4000-8000-00000000000a','HR-4','Out of Service');
insert into public.fleet_vehicle_inspections(department_id,vehicle_id,result,defect_count,critical_defect_count,inspector_user_id,created_at) values
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000001e1','Failed',1,1,'0f470000-0000-4000-8000-0000000000a1',now() - interval '3 hours'),
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000001e2','Failed',1,1,'0f470000-0000-4000-8000-0000000000a1',now() - interval '3 hours'),
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000001e4','Passed',0,0,'0f470000-0000-4000-8000-0000000000a1',now() - interval '1 hour');
insert into public.fleet_work_orders(id,department_id,vehicle_id,record_type,title,priority,status,affects_availability,created_at) values
 ('0f470000-0000-4000-8000-0000000003a1','0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000001e1','Inspection','Brakes','Critical','Open',true,now() - interval '3 hours'),
 ('0f470000-0000-4000-8000-0000000003a2','0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000001e2','Inspection','Brakes','Critical','Completed',true,now() - interval '3 hours'),
 ('0f470000-0000-4000-8000-0000000003a4','0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000001e4','Issue','Steering','Critical','Open',false,now() - interval '2 hours');

set local session authorization tracepoint_runtime;
set local role authenticated;
-- The previous image: the mechanic completes vehicle 1's work order, then its
-- readiness refresh (no hold rule) writes Available.
select set_config('tracepoint.subject_id','0f470000-0000-4000-8000-0000000000a2',true), set_config('tracepoint.department_id','0f470000-0000-4000-8000-00000000000a',true);
update public.fleet_work_orders set status='Completed', completed_at=now(), updated_by_user_id='0f470000-0000-4000-8000-0000000000a2'
where id='0f470000-0000-4000-8000-0000000003a1';
update public.fleet_vehicles set status='Available', open_issue_count=0, updated_at=now()
where id in ('0f470000-0000-4000-8000-0000000001e1','0f470000-0000-4000-8000-0000000001e2');
-- Vehicle 4: held only by its open work order; the refresh writes Attention.
update public.fleet_vehicles set status='Attention', open_issue_count=1 where id='0f470000-0000-4000-8000-0000000001e4';
-- The previous image's manager override, and vehicle 3 without a hold.
select set_config('tracepoint.subject_id','0f470000-0000-4000-8000-0000000000a3',true);
update public.fleet_vehicles set status='Available', status_reason='Back in service', status_override_active=true
where id='0f470000-0000-4000-8000-0000000001e1';
update public.fleet_vehicles set status='Attention' where id='0f470000-0000-4000-8000-0000000001e3';
reset role;
reset session authorization;

do $$
declare row record;
begin
 for row in
  select v.unit_number, v.status, v.status_override_active, v.open_issue_count,
    (select count(*) from public.audit_events e where e.entity_id=v.id and e.action='fleet_safety_hold_status_kept') as kept,
    (select count(*) from public.audit_events e where e.entity_id=v.id and e.action='fleet_safety_hold_status_kept'
       and e.actor_user_id='0f470000-0000-4000-8000-0000000000a2' and e.details->>'attempted_status' in ('Available','Attention')
       and e.details->>'status'='Out of Service') as kept_by_mechanic,
    (select count(*) from public.audit_events e where e.entity_id=v.id and e.action='fleet_safety_hold_status_kept'
       and e.actor_user_id='0f470000-0000-4000-8000-0000000000a3') as kept_by_manager
  from public.fleet_vehicles v where v.department_id='0f470000-0000-4000-8000-00000000000a'
 loop
  if (row.unit_number='HR-1' and (row.status<>'Out of Service' or row.open_issue_count<>0 or not row.status_override_active
                                  or row.kept<>2 or row.kept_by_mechanic<>1 or row.kept_by_manager<>1))
     or (row.unit_number in ('HR-2','HR-4') and (row.status<>'Out of Service' or row.kept<>1 or row.kept_by_mechanic<>1))
     or (row.unit_number='HR-3' and (row.status<>'Attention' or row.kept<>0)) then
   raise exception 'Safety hold status after the previous image''s writes: % is % (override %, open issues %), % kept audit rows (mechanic %, manager %)',
     row.unit_number, row.status, row.status_override_active, row.open_issue_count, row.kept, row.kept_by_mechanic, row.kept_by_manager;
  end if;
 end loop;
 if (select status from public.fleet_work_orders where id='0f470000-0000-4000-8000-0000000003a1') <> 'Completed' then
  raise exception 'The held vehicle''s work order completion was not kept';
 end if;
end $$;

set local session authorization tracepoint_runtime;
set local role authenticated;
select set_config('tracepoint.subject_id','0f470000-0000-4000-8000-0000000000a3',true), set_config('tracepoint.department_id','0f470000-0000-4000-8000-00000000000a',true);
-- Not in service while held: Maintenance stays allowed.
update public.fleet_vehicles set status='Maintenance' where id='0f470000-0000-4000-8000-0000000001e1';
do $$
begin
 if (select status from public.fleet_vehicles where id='0f470000-0000-4000-8000-0000000001e1') <> 'Maintenance' then
  raise exception 'A held vehicle could not be set to Maintenance';
 end if;
 begin
  update public.fleet_vehicles set safety_hold_cleared_at=now(), safety_hold_cleared_by='0f470000-0000-4000-8000-0000000000a3', safety_hold_clearance_reason=' '
  where id='0f470000-0000-4000-8000-0000000001e1';
  raise exception 'A safety hold clearance without a reason was accepted';
 exception when sqlstate '22023' then null;
 end;
end $$;
-- A manager clearance with a reason releases vehicle 1.
update public.fleet_vehicles set safety_hold_cleared_at=now(), safety_hold_cleared_by='0f470000-0000-4000-8000-0000000000a3', safety_hold_clearance_reason='Brakes verified by the shop'
where id='0f470000-0000-4000-8000-0000000001e1';
update public.fleet_vehicles set status='Available', status_override_active=false where id='0f470000-0000-4000-8000-0000000001e1';
-- An inspection without critical defects releases vehicle 2.
select set_config('tracepoint.subject_id','0f470000-0000-4000-8000-0000000000a1',true);
insert into public.fleet_vehicle_inspections(department_id,vehicle_id,result,inspector_user_id) values
 ('0f470000-0000-4000-8000-00000000000a','0f470000-0000-4000-8000-0000000001e2','Passed','0f470000-0000-4000-8000-0000000000a1');
update public.fleet_vehicles set status='Available' where id='0f470000-0000-4000-8000-0000000001e2';
-- Vehicle 4 is released once its open work order is completed.
select set_config('tracepoint.subject_id','0f470000-0000-4000-8000-0000000000a2',true);
update public.fleet_work_orders set status='Completed' where id='0f470000-0000-4000-8000-0000000003a4';
update public.fleet_vehicles set status='Available', open_issue_count=0 where id='0f470000-0000-4000-8000-0000000001e4';
reset role;
reset session authorization;

do $$
begin
 if (select string_agg(unit_number || '=' || status, ',' order by unit_number) from public.fleet_vehicles
     where department_id='0f470000-0000-4000-8000-00000000000a') <> 'HR-1=Available,HR-2=Available,HR-3=Attention,HR-4=Available' then
  raise exception 'Released vehicles: %', (select string_agg(unit_number || '=' || status, ',' order by unit_number) from public.fleet_vehicles
     where department_id='0f470000-0000-4000-8000-00000000000a');
 end if;
 if (select count(*) from public.audit_events where department_id='0f470000-0000-4000-8000-00000000000a' and action='fleet_safety_hold_status_kept') <> 4 then
  raise exception 'A release wrote a kept-status audit row';
 end if;
 if has_function_privilege('authenticated', 'public.guard_fleet_safety_hold_status()', 'execute')
    or not exists (select 1 from pg_trigger where tgname='fleet_vehicles_safety_hold_status_guard'
                   and tgrelid='public.fleet_vehicles'::regclass and tgenabled <> 'D') then
  raise exception 'The safety hold status guard is missing or callable by authenticated';
 end if;
end $$;
rollback;
