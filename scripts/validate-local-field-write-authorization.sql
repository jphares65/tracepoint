-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger. Every app call below uses the AWS runtime's
-- session shape: session user tracepoint_runtime, role authenticated, subject
-- and agency set per transaction. Covers database/aws/040 and 041.
begin;
insert into auth.users(id,email) values
 ('0b200000-0000-4000-8000-0000000000a1','b2-admin-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000f1','b2-fleet-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000e1','b2-inspector-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000e2','b2-inactive-inspector-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000d1','b2-mechanic-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000c1','b2-officer-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000c2','b2-officer2-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000c3','b2-inactive-officer-a@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000b1','b2-officer-b@example.invalid'),
 ('0b200000-0000-4000-8000-0000000000b2','b2-inspector-b@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'b2-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values
 ('0b200000-0000-4000-8000-00000000000a','B2 tenant A','local-b2-a'),
 ('0b200000-0000-4000-8000-00000000000b','B2 tenant B','local-b2-b');
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000a1',true),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000f1',true),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000e1',true),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000e2',false),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000d1',true),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000c1',true),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000c2',true),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000c3',false),
 ('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000000b1',true),
 ('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000000b2',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000a1','administrator'),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000f1','fleet_manager'),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000e1','supervisor'),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000e2','supervisor'),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000d1','mechanic'),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000c1','officer'),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000c2','officer'),
 ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000c3','officer'),
 ('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000000b1','officer'),
 ('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000000b2','supervisor');
-- An agency-configured inspector: supervisor granted perform_fleet_inspections.
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0b200000-0000-4000-8000-00000000000a','supervisor','perform_fleet_inspections'),
 ('0b200000-0000-4000-8000-00000000000b','supervisor','perform_fleet_inspections')
on conflict do nothing;
insert into public.department_features(department_id,feature_code,is_enabled) values
 ('0b200000-0000-4000-8000-00000000000a','equipment_readiness',true),
 ('0b200000-0000-4000-8000-00000000000b','equipment_readiness',true)
on conflict (department_id,feature_code) do update set is_enabled=true;
insert into public.fleet_rules(department_id) values
 ('0b200000-0000-4000-8000-00000000000a'),('0b200000-0000-4000-8000-00000000000b') on conflict do nothing;
insert into public.fleet_vehicles(id,department_id,unit_number,current_mileage,status,status_override_active) values
 ('0b200000-0000-4000-8000-0000000001a1','0b200000-0000-4000-8000-00000000000a','B2-A1',1000,'Available',false),
 ('0b200000-0000-4000-8000-0000000001a2','0b200000-0000-4000-8000-00000000000a','B2-A2',1000,'Available',true),
 ('0b200000-0000-4000-8000-0000000001b1','0b200000-0000-4000-8000-00000000000b','B2-B1',1000,'Available',false);
insert into public.fleet_vehicle_equipment(id,department_id,vehicle_id,category,name,is_required,is_critical,status) values
 ('0b200000-0000-4000-8000-0000000002a1','0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001a1','Safety','AED',true,true,'Current'),
 ('0b200000-0000-4000-8000-0000000002b1','0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000001b1','Safety','AED',true,true,'Current');
insert into public.equipment_types(id,department_id,name) values
 ('0b200000-0000-4000-8000-0000000003a1','0b200000-0000-4000-8000-00000000000a','B2 radio A'),
 ('0b200000-0000-4000-8000-0000000003b1','0b200000-0000-4000-8000-00000000000b','B2 radio B');
insert into public.equipment_assets(id,department_id,equipment_type_id,asset_number,lifecycle_status,assigned_user_id,updated_by) values
 ('0b200000-0000-4000-8000-0000000004a1','0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000003a1','B2-EQ-A1','active',null,null),
 ('0b200000-0000-4000-8000-0000000004a2','0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000003a1','B2-EQ-A2','active','0b200000-0000-4000-8000-0000000000c1','0b200000-0000-4000-8000-0000000000a1'),
 ('0b200000-0000-4000-8000-0000000004a3','0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000003a1','B2-EQ-A3','out_of_service',null,null),
 ('0b200000-0000-4000-8000-0000000004b1','0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000003b1','B2-EQ-B1','active',null,null);

set local session authorization tracepoint_runtime;
set local role authenticated;

-- NEW-01: an inspector's inspection side effects, in the handler's order.
do $$
declare affected integer; work_order uuid; open_orders integer;
begin
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000e1',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
 insert into public.fleet_vehicle_inspections(department_id,vehicle_id,inspection_type,result,mileage,hours,checklist,defect_count,critical_defect_count,inspector_user_id)
 values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001a1','Pre-Shift','Failed',1200,0,'[]'::jsonb,1,1,'0b200000-0000-4000-8000-0000000000e1');
 update public.fleet_vehicle_equipment set status='Out of Service',updated_by_user_id='0b200000-0000-4000-8000-0000000000e1',updated_at=now()
 where department_id='0b200000-0000-4000-8000-00000000000a' and id='0b200000-0000-4000-8000-0000000002a1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Inspector equipment condition update failed'; end if;
 insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,description,priority,status,affects_availability,assigned_role_code,mileage,hours,created_by_user_id,updated_by_user_id)
 values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001a1','Inspection','Pre-Shift inspection defects','AED: pads','Critical','Open',true,'mechanic',1200,0,'0b200000-0000-4000-8000-0000000000e1','0b200000-0000-4000-8000-0000000000e1')
 returning id into work_order;
 if work_order is null then raise exception 'Inspector work order was not returned'; end if;
 update public.fleet_vehicles set current_mileage=1200,current_hours=0,inspection_due_date=current_date+1,updated_by_user_id='0b200000-0000-4000-8000-0000000000e1',updated_at=now()
 where department_id='0b200000-0000-4000-8000-00000000000a' and id='0b200000-0000-4000-8000-0000000001a1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Inspector vehicle reading update failed'; end if;
 insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,details)
 values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000e1','fleet_vehicle_inspected','fleet_vehicle','0b200000-0000-4000-8000-0000000001a1','{}'::jsonb);
 select count(*) into open_orders from public.fleet_work_orders
 where department_id='0b200000-0000-4000-8000-00000000000a' and vehicle_id='0b200000-0000-4000-8000-0000000001a1' and status not in ('Completed','Cancelled');
 if open_orders <> 1 then raise exception 'Inspector status refresh cannot see open work orders'; end if;
 update public.fleet_vehicles set status='Out of Service',open_issue_count=open_orders,updated_at=now()
 where department_id='0b200000-0000-4000-8000-00000000000a' and id='0b200000-0000-4000-8000-0000000001a1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Inspector status refresh failed'; end if;
 if not exists(select 1 from public.fleet_vehicles where id='0b200000-0000-4000-8000-0000000001a1' and status='Out of Service' and current_mileage=1200 and inspection_due_date=current_date+1) then
  raise exception 'Inspector side effects were not persisted';
 end if;
end $$;

-- The inspector does not receive general fleet editing.
do $$
declare affected integer;
begin
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000e1',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
 begin update public.fleet_vehicles set unit_number='B2-RENAMED' where id='0b200000-0000-4000-8000-0000000001a1'; raise exception 'Inspector renamed a vehicle'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set status='Retired' where id='0b200000-0000-4000-8000-0000000001a1'; raise exception 'Inspector retired a vehicle'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set status_override_active=false where id='0b200000-0000-4000-8000-0000000001a2'; raise exception 'Inspector cleared a manual override'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set status='Maintenance' where id='0b200000-0000-4000-8000-0000000001a2'; raise exception 'Inspector changed an overridden status'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set status_reason='Changed' where id='0b200000-0000-4000-8000-0000000001a2'; raise exception 'Inspector changed the override reason'; exception when insufficient_privilege then null; end;
 -- A critical defect still takes an overridden vehicle out of service (B4 FLT-01), but never back.
 update public.fleet_vehicles set status='Out of Service', status_reason='Critical inspection defect' where id='0b200000-0000-4000-8000-0000000001a2';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Inspector could not take an overridden vehicle out of service'; end if;
 begin update public.fleet_vehicles set status='Available' where id='0b200000-0000-4000-8000-0000000001a2'; raise exception 'Inspector returned an overridden vehicle to Available'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set current_mileage=10 where id='0b200000-0000-4000-8000-0000000001a1'; raise exception 'Inspector lowered the odometer'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set next_service_date=current_date where id='0b200000-0000-4000-8000-0000000001a1'; raise exception 'Inspector changed service dates'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set updated_by_user_id='0b200000-0000-4000-8000-0000000000f1' where id='0b200000-0000-4000-8000-0000000001a1'; raise exception 'Inspector forged the editor'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicle_equipment set name='Renamed' where id='0b200000-0000-4000-8000-0000000002a1'; raise exception 'Inspector renamed equipment'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicle_equipment set status='Removed' where id='0b200000-0000-4000-8000-0000000002a1'; raise exception 'Inspector removed equipment'; exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001a1','Repair','Not an inspection','Open','0b200000-0000-4000-8000-0000000000e1','0b200000-0000-4000-8000-0000000000e1');
  raise exception 'Inspector created a repair work order';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001a1','Inspection','Completed defect','Completed','0b200000-0000-4000-8000-0000000000e1','0b200000-0000-4000-8000-0000000000e1');
  raise exception 'Inspector created a closed work order';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001a1','Inspection','Forged author','Open','0b200000-0000-4000-8000-0000000000f1','0b200000-0000-4000-8000-0000000000f1');
  raise exception 'Inspector forged a work order author';
 exception when insufficient_privilege then null; end;
 update public.fleet_work_orders set status='Completed' where department_id='0b200000-0000-4000-8000-00000000000a';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Inspector edited a work order'; end if;
 begin
  insert into public.audit_events(department_id,actor_user_id,action,entity_type) values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000e1','firearm_updated','firearm');
  raise exception 'Inspector wrote a non-fleet audit event';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.audit_events(department_id,actor_user_id,action,entity_type) values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000f1','fleet_vehicle_updated','fleet_vehicle');
  raise exception 'Inspector forged an audit actor';
 exception when insufficient_privilege then null; end;
end $$;

-- Cross-tenant: an agency A inspector and an agency B inspector.
do $$
declare affected integer;
begin
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000e1',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
 update public.fleet_vehicles set current_mileage=5000 where id='0b200000-0000-4000-8000-0000000001b1';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Inspector updated a foreign vehicle'; end if;
 update public.fleet_vehicle_equipment set status='Attention' where id='0b200000-0000-4000-8000-0000000002b1';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Inspector updated foreign equipment'; end if;
 if exists(select 1 from public.fleet_work_orders where department_id='0b200000-0000-4000-8000-00000000000b') then raise exception 'Foreign work orders leaked'; end if;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000001b1','Inspection','Foreign','Open','0b200000-0000-4000-8000-0000000000e1','0b200000-0000-4000-8000-0000000000e1');
  raise exception 'Inspector created a foreign work order';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
  values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001b1','Inspection','Foreign vehicle','Open','0b200000-0000-4000-8000-0000000000e1','0b200000-0000-4000-8000-0000000000e1');
  raise exception 'Inspector attached a work order to a foreign vehicle';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.audit_events(department_id,actor_user_id,action,entity_type) values ('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000000e1','fleet_vehicle_inspected','fleet_vehicle');
  raise exception 'Inspector wrote a foreign audit event';
 exception when insufficient_privilege then null; end;
 -- Agency B's inspector, in its own session and in a forged agency A session.
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000b2',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000b',true);
 update public.fleet_vehicles set current_mileage=5000 where id='0b200000-0000-4000-8000-0000000001a1';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign inspector updated a vehicle'; end if;
 perform set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
 update public.fleet_vehicle_equipment set status='Attention' where id='0b200000-0000-4000-8000-0000000002a1';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign inspector updated equipment'; end if;
 begin
  insert into public.audit_events(department_id,actor_user_id,action,entity_type) values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000b2','fleet_vehicle_inspected','fleet_vehicle');
  raise exception 'Foreign inspector wrote an audit event';
 exception when insufficient_privilege then null; end;
 -- Agency B's inspector may not act on its own agency from an agency A session.
 update public.fleet_vehicles set current_mileage=5000 where id='0b200000-0000-4000-8000-0000000001b1';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Inspector wrote outside the session agency'; end if;
end $$;

-- Inactive inspector and an unrelated officer receive nothing.
do $$
declare affected integer; subject text;
begin
 foreach subject in array array['0b200000-0000-4000-8000-0000000000e2','0b200000-0000-4000-8000-0000000000c1'] loop
  perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
  update public.fleet_vehicles set current_mileage=5000,status='Available' where id='0b200000-0000-4000-8000-0000000001a1';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Unauthorized subject % updated a vehicle', subject; end if;
  update public.fleet_vehicle_equipment set status='Current' where id='0b200000-0000-4000-8000-0000000002a1';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Unauthorized subject % updated equipment', subject; end if;
  if exists(select 1 from public.fleet_work_orders) then raise exception 'Unauthorized subject % read work orders', subject; end if;
  begin
   insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,status,created_by_user_id,updated_by_user_id)
   values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000001a1','Inspection','Unauthorized','Open',subject::uuid,subject::uuid);
   raise exception 'Unauthorized subject % created a work order', subject;
  exception when insufficient_privilege then null; end;
  begin
   insert into public.audit_events(department_id,actor_user_id,action,entity_type) values ('0b200000-0000-4000-8000-00000000000a',subject::uuid,'fleet_vehicle_inspected','fleet_vehicle');
   raise exception 'Unauthorized subject % wrote a fleet audit event', subject;
  exception when insufficient_privilege then null; end;
 end loop;
end $$;

-- Mechanics maintain service readings and the automated status, nothing else;
-- fleet managers without administer_department can audit fleet writes.
do $$
declare affected integer;
begin
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000d1',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
 update public.fleet_vehicles set last_service_date=current_date,next_service_date=current_date+90,current_mileage=1300,updated_by_user_id='0b200000-0000-4000-8000-0000000000d1'
 where id='0b200000-0000-4000-8000-0000000001a1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Mechanic service update failed'; end if;
 update public.fleet_vehicles set status='Maintenance',open_issue_count=1 where id='0b200000-0000-4000-8000-0000000001a1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Mechanic status refresh failed'; end if;
 begin update public.fleet_vehicles set inspection_due_date=current_date+30 where id='0b200000-0000-4000-8000-0000000001a1'; raise exception 'Mechanic changed the inspection due date'; exception when insufficient_privilege then null; end;
 begin update public.fleet_vehicles set vin=null,notes='x' where id='0b200000-0000-4000-8000-0000000001a1'; raise exception 'Mechanic edited vehicle details'; exception when insufficient_privilege then null; end;
 insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id) values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000d1','fleet_work_order_updated','fleet_vehicle','0b200000-0000-4000-8000-0000000001a1');
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000f1',true);
 insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id) values ('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000000f1','fleet_vehicle_inspected','fleet_vehicle','0b200000-0000-4000-8000-0000000001a1');
 update public.fleet_vehicles set notes='Fleet manager edit' where id='0b200000-0000-4000-8000-0000000001a1';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'Fleet manager general edit regressed'; end if;
end $$;

-- EQP-06: self-service custody through the bounded function.
do $$
declare result jsonb; visible integer;
begin
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000c1',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
 select count(*) into visible from public.equipment_assets;
 if visible <> 2 then raise exception 'Officer should see own and available equipment only, saw %', visible; end if;
 result := public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a1','check-out','serviceable','[condition=serviceable]');
 if result->>'assigned_user_id' is distinct from '0b200000-0000-4000-8000-0000000000c1' then raise exception 'Officer check-out failed'; end if;
 if not exists(select 1 from public.equipment_asset_assignments where equipment_asset_id='0b200000-0000-4000-8000-0000000004a1' and returned_at is null and assigned_by='0b200000-0000-4000-8000-0000000000c1' and assignment_notes='[condition=serviceable]') then
  raise exception 'Check-out custody history missing';
 end if;
 result := public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a2','check-in','damaged','[condition=damaged] cracked');
 if result->>'assigned_user_id' is not null or result->>'lifecycle_status' <> 'out_of_service' then raise exception 'Officer check-in failed'; end if;
 if not exists(select 1 from public.equipment_asset_assignments where equipment_asset_id='0b200000-0000-4000-8000-0000000004a2' and returned_by='0b200000-0000-4000-8000-0000000000c1' and return_notes='[condition=damaged] cracked') then
  raise exception 'Check-in custody history missing';
 end if;
 if public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a3','check-out','serviceable','x') is not null then
  raise exception 'Out-of-service equipment was checked out';
 end if;
 begin
  perform public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a1','check-out','damaged','x');
  raise exception 'Unserviceable check-out accepted';
 exception when invalid_parameter_value then null; end;
end $$;

do $$
declare affected integer; subject text;
begin
 -- Another officer cannot check in or take equipment held by someone else.
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000c2',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
 if public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a1','check-in','serviceable','x') is not null then raise exception 'Officer checked in another officer''s equipment'; end if;
 if public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a1','check-out','serviceable','x') is not null then raise exception 'Officer took held equipment'; end if;
 if exists(select 1 from public.equipment_assets where id in ('0b200000-0000-4000-8000-0000000004a1','0b200000-0000-4000-8000-0000000004a2','0b200000-0000-4000-8000-0000000004a3')) then raise exception 'Held or unavailable equipment leaked'; end if;
 -- Members still have no direct asset or history writes.
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000c1',true);
 update public.equipment_assets set notes='direct' where department_id='0b200000-0000-4000-8000-00000000000a';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Officer updated equipment directly'; end if;
 update public.equipment_asset_assignments set return_notes='forged' where department_id='0b200000-0000-4000-8000-00000000000a';
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Officer edited custody history directly'; end if;
 -- Cross-tenant officer in its own and in a forged agency A session, and inactive member.
 foreach subject in array array['0b200000-0000-4000-8000-0000000000b1','0b200000-0000-4000-8000-0000000000c3'] loop
  perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000a',true);
  if exists(select 1 from public.equipment_assets where department_id='0b200000-0000-4000-8000-00000000000a') then raise exception 'Subject % saw agency A equipment', subject; end if;
  begin
   perform public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a1','check-in','serviceable','x');
   raise exception 'Subject % operated agency A custody', subject;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000b1',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000b',true);
 begin
  perform public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000a','0b200000-0000-4000-8000-0000000004a1','check-in','serviceable','x');
  raise exception 'Foreign agency session operated agency A custody';
 exception when insufficient_privilege then null; end;
 if public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000004a1','check-out','serviceable','x') is not null then
  raise exception 'Agency A equipment was reachable through agency B';
 end if;
end $$;

-- Equipment Readiness disabled for the agency: no pool and no custody.
reset role;
reset session authorization;
update public.department_features set is_enabled=false where department_id='0b200000-0000-4000-8000-00000000000b' and feature_code='equipment_readiness';
set local session authorization tracepoint_runtime;
set local role authenticated;
do $$
begin
 perform set_config('tracepoint.subject_id','0b200000-0000-4000-8000-0000000000b1',true), set_config('tracepoint.department_id','0b200000-0000-4000-8000-00000000000b',true);
 if exists(select 1 from public.equipment_assets) then raise exception 'Pool visible with the module disabled'; end if;
 begin
  perform public.operate_equipment_self_custody('0b200000-0000-4000-8000-00000000000b','0b200000-0000-4000-8000-0000000004b1','check-out','serviceable','x');
  raise exception 'Custody accepted with the module disabled';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
reset session authorization;
rollback;
