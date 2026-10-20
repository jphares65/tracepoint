-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers database/aws/045: one
-- inspection eligibility rule for inspections and issue reports.
-- Agency A lists no inspection roles (Fleet access, view_fleet, is enough).
-- Agency C lists 'officer'; agency B is foreign and also lists 'officer'.
begin;
insert into auth.users(id,email) values
 ('0f200000-0000-4000-8000-0000000000a1','f2-viewer-a@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000a2','f2-officer-a@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000a3','f2-mechanic-a@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000a4','f2-inactive-viewer-a@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000c1','f2-officer-c@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000c2','f2-viewer-c@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000c3','f2-mechanic-c@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000c4','f2-inspector-c@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000c5','f2-chief-c@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000c6','f2-inactive-officer-c@example.invalid'),
 ('0f200000-0000-4000-8000-0000000000b1','f2-officer-b@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'f2-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values
 ('0f200000-0000-4000-8000-00000000000a','F2 tenant A','local-f2-a'),
 ('0f200000-0000-4000-8000-00000000000c','F2 tenant C','local-f2-c'),
 ('0f200000-0000-4000-8000-00000000000b','F2 tenant B','local-f2-b');
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a1',true),
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a2',true),
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a3',true),
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a4',false),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c1',true),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c2',true),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c3',true),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c4',true),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c5',true),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c6',false),
 ('0f200000-0000-4000-8000-00000000000b','0f200000-0000-4000-8000-0000000000b1',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a1','command_staff'),
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a2','officer'),
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a3','mechanic'),
 ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000000a4','command_staff'),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c1','officer'),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c2','command_staff'),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c3','mechanic'),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c4','supervisor'),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c5','chief'),
 ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c6','officer'),
 ('0f200000-0000-4000-8000-00000000000b','0f200000-0000-4000-8000-0000000000b1','officer');
-- Command staff get Fleet access (view_fleet); supervisors in C perform inspections.
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0f200000-0000-4000-8000-00000000000a','command_staff','view_fleet'),
 ('0f200000-0000-4000-8000-00000000000c','command_staff','view_fleet'),
 ('0f200000-0000-4000-8000-00000000000c','supervisor','perform_fleet_inspections')
on conflict do nothing;
insert into public.department_features(department_id,feature_code,is_enabled) values
 ('0f200000-0000-4000-8000-00000000000a','equipment_readiness',true)
on conflict (department_id,feature_code) do update set is_enabled=true;
insert into public.fleet_rules(department_id) values
 ('0f200000-0000-4000-8000-00000000000a'),('0f200000-0000-4000-8000-00000000000c'),('0f200000-0000-4000-8000-00000000000b') on conflict do nothing;
update public.fleet_rules set inspection_role_codes=array['officer']
where department_id in ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-00000000000b');
insert into public.fleet_vehicles(id,department_id,unit_number,current_mileage,status,status_override_active) values
 ('0f200000-0000-4000-8000-0000000001a1','0f200000-0000-4000-8000-00000000000a','F2-A1',1000,'Available',false),
 ('0f200000-0000-4000-8000-0000000001c1','0f200000-0000-4000-8000-00000000000c','F2-C1',1000,'Available',false),
 ('0f200000-0000-4000-8000-0000000001c2','0f200000-0000-4000-8000-00000000000c','F2-C2',1000,'Available',true),
 ('0f200000-0000-4000-8000-0000000001b1','0f200000-0000-4000-8000-00000000000b','F2-B1',1000,'Available',false);
insert into public.fleet_vehicle_equipment(id,department_id,vehicle_id,category,name,is_required,is_critical,status) values
 ('0f200000-0000-4000-8000-0000000002c1','0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Safety','AED',true,true,'Current');
insert into public.fleet_work_orders(id,department_id,vehicle_id,record_type,title,status,labor_cost,total_cost) values
 ('0f200000-0000-4000-8000-0000000005c1','0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Repair','Existing repair','In Progress',100,250);
-- Equipment custody held by agency A's officer.
insert into public.equipment_types(id,department_id,name) values
 ('0f200000-0000-4000-8000-0000000003a1','0f200000-0000-4000-8000-00000000000a','F2 radio A');
insert into public.equipment_assets(id,department_id,equipment_type_id,asset_number,lifecycle_status,assigned_user_id) values
 ('0f200000-0000-4000-8000-0000000004a1','0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000003a1','F2-EQ-A1','active','0f200000-0000-4000-8000-0000000000a2');
-- (the asset's assignment trigger records the custody history row)

set local session authorization tracepoint_runtime;
set local role authenticated;

-- The rule, subject by subject, in each subject's own agency session.
do $$
declare subject text; agency text; expected boolean; actual boolean;
begin
 for subject, agency, expected in values
  ('0f200000-0000-4000-8000-0000000000a1','0f200000-0000-4000-8000-00000000000a',true),  -- view_fleet, empty list
  ('0f200000-0000-4000-8000-0000000000a2','0f200000-0000-4000-8000-00000000000a',false), -- no Fleet access, empty list
  ('0f200000-0000-4000-8000-0000000000a3','0f200000-0000-4000-8000-00000000000a',true),  -- mechanic has view_fleet
  ('0f200000-0000-4000-8000-0000000000a4','0f200000-0000-4000-8000-00000000000a',false), -- inactive
  ('0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-00000000000c',true),  -- listed role
  ('0f200000-0000-4000-8000-0000000000c2','0f200000-0000-4000-8000-00000000000c',false), -- view_fleet, not listed
  ('0f200000-0000-4000-8000-0000000000c3','0f200000-0000-4000-8000-00000000000c',false), -- mechanic, not listed
  ('0f200000-0000-4000-8000-0000000000c4','0f200000-0000-4000-8000-00000000000c',true),  -- perform_fleet_inspections
  ('0f200000-0000-4000-8000-0000000000c5','0f200000-0000-4000-8000-00000000000c',false), -- chief, not listed
  ('0f200000-0000-4000-8000-0000000000c6','0f200000-0000-4000-8000-00000000000c',false), -- listed role, inactive
  ('0f200000-0000-4000-8000-0000000000b1','0f200000-0000-4000-8000-00000000000c',false)  -- listed role in another agency
 loop
  perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id',agency,true);
  actual := public.can_submit_fleet_inspection(agency::uuid);
  if actual is distinct from expected then raise exception 'Inspection eligibility for % in % is %, expected %', subject, agency, actual, expected; end if;
 end loop;
end $$;

-- A listed-role officer inspects, with every side effect the route performs.
do $$
declare affected integer; inspection uuid; work_order uuid; open_orders integer;
begin
 perform set_config('tracepoint.subject_id','0f200000-0000-4000-8000-0000000000c1',true), set_config('tracepoint.department_id','0f200000-0000-4000-8000-00000000000c',true);
 if not exists(select 1 from public.fleet_rules where department_id='0f200000-0000-4000-8000-00000000000c') then raise exception 'Eligible officer cannot read the fleet rules'; end if;
 if not exists(select 1 from public.fleet_vehicles where id='0f200000-0000-4000-8000-0000000001c1') then raise exception 'Eligible officer cannot read the vehicle'; end if;
 if not exists(select 1 from public.fleet_vehicle_equipment where id='0f200000-0000-4000-8000-0000000002c1') then raise exception 'Eligible officer cannot read the required equipment'; end if;
 insert into public.fleet_vehicle_inspections(department_id,vehicle_id,inspection_type,result,mileage,hours,checklist,defect_count,critical_defect_count,inspector_user_id)
 values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Pre-Shift','Failed',1200,0,'[]'::jsonb,1,1,'0f200000-0000-4000-8000-0000000000c1')
 returning id into inspection;
 if inspection is null then raise exception 'Eligible officer inspection was not returned'; end if;
 update public.fleet_vehicle_equipment set status='Out of Service',updated_by_user_id='0f200000-0000-4000-8000-0000000000c1',updated_at=now()
 where department_id='0f200000-0000-4000-8000-00000000000c' and id='0f200000-0000-4000-8000-0000000002c1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Eligible officer equipment condition update failed'; end if;
 insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,description,priority,status,affects_availability,assigned_role_code,mileage,hours,created_by_user_id,updated_by_user_id)
 values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Inspection','Pre-Shift inspection defects','AED: pads','Critical','Open',true,'mechanic',1200,0,'0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-0000000000c1')
 returning id into work_order;
 if work_order is null then raise exception 'Eligible officer defect work order was not returned'; end if;
 update public.fleet_vehicles set current_mileage=1200,current_hours=0,inspection_due_date=current_date+1,updated_by_user_id='0f200000-0000-4000-8000-0000000000c1',updated_at=now()
 where department_id='0f200000-0000-4000-8000-00000000000c' and id='0f200000-0000-4000-8000-0000000001c1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Eligible officer vehicle reading update failed'; end if;
 insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,details)
 values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000000c1','fleet_vehicle_inspected','fleet_vehicle','0f200000-0000-4000-8000-0000000001c1','{}'::jsonb);
 select count(*) into open_orders from public.fleet_work_orders
 where department_id='0f200000-0000-4000-8000-00000000000c' and vehicle_id='0f200000-0000-4000-8000-0000000001c1' and status not in ('Completed','Cancelled');
 if open_orders <> 2 then raise exception 'Eligible officer status refresh sees % open work orders', open_orders; end if;
 perform 1 from public.fleet_vehicle_inspections where id=inspection;
 if not found then raise exception 'Eligible officer status refresh cannot read the latest inspection'; end if;
 update public.fleet_vehicles set status='Out of Service',open_issue_count=open_orders,updated_at=now()
 where department_id='0f200000-0000-4000-8000-00000000000c' and id='0f200000-0000-4000-8000-0000000001c1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Eligible officer status refresh failed'; end if;
end $$;

-- Issue reporting by eligible officers (listed role in C, view_fleet in A).
do $$
declare affected integer; issue uuid; subject text; agency text; vehicle text;
begin
 for subject, agency, vehicle in values
  ('0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c2'),
  ('0f200000-0000-4000-8000-0000000000a1','0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000001a1')
 loop
  perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id',agency,true);
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,issue_category,title,description,priority,status,affects_availability,assigned_role_code,mileage,created_by_user_id,updated_by_user_id)
  values (agency::uuid,vehicle::uuid,'Issue','Brakes','Brakes grinding','Front left','Critical','Open',true,'mechanic',1300,subject::uuid,subject::uuid)
  returning id into issue;
  if issue is null then raise exception 'Eligible subject % could not report an issue', subject; end if;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,details)
  values (agency::uuid,subject::uuid,'fleet_issue_reported','fleet_vehicle',vehicle::uuid,'{}'::jsonb);
  -- The issue route moves the odometer forward, then refreshes readiness.
  update public.fleet_vehicles set current_mileage=1300,updated_by_user_id=subject::uuid,updated_at=now() where id=vehicle::uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Issue reporter % could not record the reading', subject; end if;
  update public.fleet_vehicles set status='Out of Service',open_issue_count=1,updated_at=now() where id=vehicle::uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Issue reporter % readiness refresh failed', subject; end if;
  if not exists(select 1 from public.fleet_vehicles where id=vehicle::uuid and status='Out of Service' and current_mileage=1300) then
   raise exception 'Issue reporter % side effects were not persisted', subject;
  end if;
 end loop;
end $$;

-- Eligible officers gain no fleet-management privileges.
do $$
declare affected integer; field text;
begin
 perform set_config('tracepoint.subject_id','0f200000-0000-4000-8000-0000000000c1',true), set_config('tracepoint.department_id','0f200000-0000-4000-8000-00000000000c',true);
 foreach field in array array['labor_cost','parts_cost','total_cost','assigned_user_id','mechanic_name','vendor','scheduled_for','due_date','resolution','started_at','completed_at','returned_to_service_at'] loop
  begin
   execute format('insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id,%I) values (%L,%L,%L,%L,%L,%L,%L,%L)', field,
    '0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Issue','Managed field','Open','0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-0000000000c1',
    case when field like '%cost' then '10' when field like '%user_id' then '0f200000-0000-4000-8000-0000000000c3' when field like '%_at' then now()::text when field in ('scheduled_for','due_date') then current_date::text else 'x' end);
   raise exception 'Issue reporter set %', field;
  exception when insufficient_privilege then null; end;
 end loop;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Issue','Closed issue','Completed','0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-0000000000c1');
  raise exception 'Issue reporter created a closed issue';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Issue','Forged author','Open','0f200000-0000-4000-8000-0000000000c4','0f200000-0000-4000-8000-0000000000c4');
  raise exception 'Issue reporter forged the author';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Repair','Not an issue','Open','0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-0000000000c1');
  raise exception 'Issue reporter created a repair work order';
 exception when insufficient_privilege then null; end;
 update public.fleet_work_orders set status='Completed', total_cost=1 where department_id='0f200000-0000-4000-8000-00000000000c';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Issue reporter managed a work order'; end if;
 delete from public.fleet_work_orders where department_id='0f200000-0000-4000-8000-00000000000c';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Issue reporter deleted a work order'; end if;
 begin update public.fleet_vehicles set current_mileage=10 where id='0f200000-0000-4000-8000-0000000001c1'; raise exception 'Issue reporter lowered the odometer'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set next_service_date=current_date where id='0f200000-0000-4000-8000-0000000001c1'; raise exception 'Issue reporter changed service dates'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set unit_number='F2-RENAMED' where id='0f200000-0000-4000-8000-0000000001c1'; raise exception 'Issue reporter renamed a vehicle'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set status='Available' where id='0f200000-0000-4000-8000-0000000001c2'; raise exception 'Issue reporter returned an overridden vehicle to Available'; exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_vehicle_inspections(department_id,vehicle_id,result,inspector_user_id)
  values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Passed','0f200000-0000-4000-8000-0000000000c4');
  raise exception 'Eligible officer forged the inspector';
 exception when insufficient_privilege then null; end;
end $$;

-- Ineligible subjects: not listed, no Fleet access, inactive, or another agency.
do $$
declare affected integer; subject text; agency text; vehicle text; audit_checked boolean;
begin
 -- Command staff and chiefs keep their general audit rights (audit_events_insert_managers).
 for subject, agency, vehicle, audit_checked in values
  ('0f200000-0000-4000-8000-0000000000c2','0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1',false),
  ('0f200000-0000-4000-8000-0000000000c5','0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1',false),
  ('0f200000-0000-4000-8000-0000000000c6','0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1',true),
  ('0f200000-0000-4000-8000-0000000000a2','0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000001a1',true),
  ('0f200000-0000-4000-8000-0000000000a4','0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000001a1',true),
  ('0f200000-0000-4000-8000-0000000000b1','0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1',true), -- forged agency C session
  ('0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-00000000000b','0f200000-0000-4000-8000-0000000001b1',true)  -- agency B session
 loop
  perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id',agency,true);
  begin
   insert into public.fleet_vehicle_inspections(department_id,vehicle_id,result,inspector_user_id) values (agency::uuid,vehicle::uuid,'Passed',subject::uuid);
   raise exception 'Ineligible subject % inspected in %', subject, agency;
  exception when insufficient_privilege then null; end;
  begin
   insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
   values (agency::uuid,vehicle::uuid,'Issue','Ineligible','Open',subject::uuid,subject::uuid);
   raise exception 'Ineligible subject % reported an issue in %', subject, agency;
  exception when insufficient_privilege then null; end;
  if audit_checked then begin
   insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id) values (agency::uuid,subject::uuid,'fleet_issue_reported','fleet_vehicle',vehicle::uuid);
   raise exception 'Ineligible subject % wrote a fleet audit event in %', subject, agency;
  exception when insufficient_privilege then null; end; end if;
  update public.fleet_vehicles set current_mileage=5000 where id=vehicle::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Ineligible subject % updated a vehicle in %', subject, agency; end if;
 end loop;
 -- Agency C's eligible officer reaches nothing of agency A or B from its own session.
 perform set_config('tracepoint.subject_id','0f200000-0000-4000-8000-0000000000c1',true), set_config('tracepoint.department_id','0f200000-0000-4000-8000-00000000000c',true);
 if exists(select 1 from public.fleet_vehicles where department_id <> '0f200000-0000-4000-8000-00000000000c') then raise exception 'Foreign vehicles leaked'; end if;
 if exists(select 1 from public.fleet_work_orders where department_id <> '0f200000-0000-4000-8000-00000000000c') then raise exception 'Foreign work orders leaked'; end if;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001b1','Issue','Foreign vehicle','Open','0f200000-0000-4000-8000-0000000000c1','0f200000-0000-4000-8000-0000000000c1');
  raise exception 'Issue attached to a foreign vehicle';
 exception when insufficient_privilege then null; end;
end $$;

-- Mechanics: inspector writes only where the rule makes them eligible.
do $$
declare affected integer;
begin
 perform set_config('tracepoint.subject_id','0f200000-0000-4000-8000-0000000000c3',true), set_config('tracepoint.department_id','0f200000-0000-4000-8000-00000000000c',true);
 begin update public.fleet_vehicles set inspection_due_date=current_date+30 where id='0f200000-0000-4000-8000-0000000001c1'; raise exception 'Unlisted mechanic changed the inspection due date'; exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_vehicle_inspections(department_id,vehicle_id,result,inspector_user_id) values ('0f200000-0000-4000-8000-00000000000c','0f200000-0000-4000-8000-0000000001c1','Passed','0f200000-0000-4000-8000-0000000000c3');
  raise exception 'Unlisted mechanic inspected';
 exception when insufficient_privilege then null; end;
 perform set_config('tracepoint.subject_id','0f200000-0000-4000-8000-0000000000a3',true), set_config('tracepoint.department_id','0f200000-0000-4000-8000-00000000000a',true);
 insert into public.fleet_vehicle_inspections(department_id,vehicle_id,result,inspector_user_id) values ('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000001a1','Passed','0f200000-0000-4000-8000-0000000000a3');
 update public.fleet_vehicles set inspection_due_date=current_date+1 where id='0f200000-0000-4000-8000-0000000001a1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Eligible mechanic could not record the inspection due date'; end if;
end $$;

-- Eligibility does not reveal another officer's equipment custody.
do $$
begin
 perform set_config('tracepoint.subject_id','0f200000-0000-4000-8000-0000000000a1',true), set_config('tracepoint.department_id','0f200000-0000-4000-8000-00000000000a',true);
 if not public.can_submit_fleet_inspection('0f200000-0000-4000-8000-00000000000a') then raise exception 'Custody check needs an eligible inspector'; end if;
 if exists(select 1 from public.equipment_assets where id='0f200000-0000-4000-8000-0000000004a1') then raise exception 'Inspector saw another officer''s equipment'; end if;
 if exists(select 1 from public.equipment_asset_assignments where equipment_asset_id='0f200000-0000-4000-8000-0000000004a1') then raise exception 'Inspector saw another officer''s custody history'; end if;
 if public.operate_equipment_self_custody('0f200000-0000-4000-8000-00000000000a','0f200000-0000-4000-8000-0000000004a1','check-in','serviceable','x') is not null then raise exception 'Inspector checked in another officer''s equipment'; end if;
 perform set_config('tracepoint.subject_id','0f200000-0000-4000-8000-0000000000a2',true);
 if not exists(select 1 from public.equipment_asset_assignments where equipment_asset_id='0f200000-0000-4000-8000-0000000004a1') then raise exception 'Holder lost sight of own custody history'; end if;
end $$;
reset role;
reset session authorization;
rollback;
