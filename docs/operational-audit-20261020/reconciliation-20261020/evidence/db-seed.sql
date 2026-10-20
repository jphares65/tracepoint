\set ON_ERROR_STOP 1
-- Mirrors deployment bootstrap: runtime role gets LOGIN after migrations (003 comment). No password (trust auth, local only).
alter role tracepoint_runtime login;
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a0000000-0000-4000-8000-0000000000a1','admin.a@example.test','{"full_name":"Dept A Admin"}'),
 ('a0000000-0000-4000-8000-0000000000f1','fleetmgr.a@example.test','{"full_name":"Fleet Manager A"}'),
 ('a0000000-0000-4000-8000-0000000000e1','inspector.a@example.test','{"full_name":"Fleet Inspector A"}'),
 ('a0000000-0000-4000-8000-0000000000c1','officer.a@example.test','{"full_name":"Officer A1"}'),
 ('a0000000-0000-4000-8000-0000000000c2','officer2.a@example.test','{"full_name":"Officer A2"}'),
 ('a0000000-0000-4000-8000-0000000000d1','equipmgr.a@example.test','{"full_name":"Equipment Manager A"}'),
 ('b0000000-0000-4000-8000-0000000000a1','admin.b@example.test','{"full_name":"Dept B Admin"}'),
 ('b0000000-0000-4000-8000-0000000000c1','officer.b@example.test','{"full_name":"Officer B1"}'),
 ('90000000-0000-4000-8000-000000000001','platform@example.test','{"full_name":"Platform Admin"}'),
 ('80000000-0000-4000-8000-000000000001','nomember@example.test','{"full_name":"No Membership"}');
insert into public.profiles(id,full_name,email) select id, raw_user_meta_data->>'full_name', email from auth.users on conflict (id) do nothing;
insert into public.departments(id,name,short_name,slug,created_by) values
 ('dddddddd-0000-4000-8000-00000000000a','Dept A','DA','dept-a','a0000000-0000-4000-8000-0000000000a1'),
 ('dddddddd-0000-4000-8000-00000000000b','Dept B','DB','dept-b','b0000000-0000-4000-8000-0000000000a1');
insert into public.department_memberships(department_id,user_id) values
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000a1'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000f1'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000e1'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c1'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c2'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000d1'),
 ('dddddddd-0000-4000-8000-00000000000b','b0000000-0000-4000-8000-0000000000a1'),
 ('dddddddd-0000-4000-8000-00000000000b','b0000000-0000-4000-8000-0000000000c1');
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000a1','administrator'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000f1','fleet_manager'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000e1','supervisor'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c1','officer'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c2','officer'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000d1','armorer'),
 ('dddddddd-0000-4000-8000-00000000000b','b0000000-0000-4000-8000-0000000000a1','administrator'),
 ('dddddddd-0000-4000-8000-00000000000b','b0000000-0000-4000-8000-0000000000c1','officer');
-- Department-level permission matrix configuration (what a dept admin does in the app):
-- "fleet inspector" = supervisor role granted perform_fleet_inspections in Dept A.
-- "equipment manager" = armorer role granted manage_equipment in Dept A.
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('dddddddd-0000-4000-8000-00000000000a','supervisor','perform_fleet_inspections'),
 ('dddddddd-0000-4000-8000-00000000000a','armorer','manage_equipment');
insert into public.platform_admins(user_id,display_name,is_active) values ('90000000-0000-4000-8000-000000000001','Platform Admin',true);
insert into public.fleet_rules(department_id) values ('dddddddd-0000-4000-8000-00000000000a') on conflict do nothing;
insert into public.fleet_vehicles(id,department_id,unit_number,current_mileage) values
 ('feee0000-0000-4000-8000-00000000000a','dddddddd-0000-4000-8000-00000000000a','A-101',1000);
insert into public.fleet_vehicle_equipment(id,department_id,vehicle_id,category,name,is_required,is_critical,status) values
 ('fe000000-0000-4000-8000-0000000000e1','dddddddd-0000-4000-8000-00000000000a','feee0000-0000-4000-8000-00000000000a','Safety','AED',true,true,'Current');
insert into public.equipment_types(id,department_id,name) values ('e7000000-0000-4000-8000-00000000000a','dddddddd-0000-4000-8000-00000000000a','Radio');
insert into public.equipment_assets(id,department_id,equipment_type_id,serial_number,asset_number,lifecycle_status) values
 ('ea000000-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-00000000000a','e7000000-0000-4000-8000-00000000000a','RAD-1','EQ-1','active'),
 ('ea000000-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-00000000000a','e7000000-0000-4000-8000-00000000000a','RAD-2','EQ-2','active');
insert into public.firearms(id,department_id,serial_number,make,model,caliber,firearm_type) values
 ('f1000000-0000-4000-8000-00000000000b','dddddddd-0000-4000-8000-00000000000b','B-SN-1','Glock','17','9mm','handgun');
insert into public.training_certifications(department_id,user_id,certification_title) values
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c2','Officer A2 private cert'),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c1','Officer A1 own cert');
insert into public.qualification_results(department_id,officer_user_id,qualification_date,score,record_origin,historical_course_name,passed) values
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c2','2026-09-01',71,'historical_import','Handgun Qual',false),
 ('dddddddd-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c1','2026-09-01',95,'historical_import','Handgun Qual',true);
insert into public.agency_training_events(id,department_id,title,starts_at) values
 ('7e000000-0000-4000-8000-00000000000a','dddddddd-0000-4000-8000-00000000000a','In-service','2026-09-10');
insert into public.agency_training_attendees(department_id,event_id,user_id) values
 ('dddddddd-0000-4000-8000-00000000000a','7e000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-0000000000c2');
commit;
select role_code, permission_code from department_role_permissions where department_id='dddddddd-0000-4000-8000-00000000000a' and role_code in ('supervisor','fleet_manager','officer','armorer') order by 1,2;
