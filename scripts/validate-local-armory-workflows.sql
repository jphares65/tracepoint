-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL.
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','local-rls@example.invalid');
insert into public.profiles(id,full_name) values ('00000000-0000-4000-8000-000000000001','Disposable RLS subject') on conflict(id) do nothing;
insert into public.departments(id,name,slug) values
 ('00000000-0000-4000-8000-000000000011','RLS tenant A','local-rls-a'),
 ('00000000-0000-4000-8000-000000000012','RLS tenant B','local-rls-b');
insert into public.department_memberships(department_id,user_id) values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001');
insert into public.equipment_types(department_id,name) values
 ('00000000-0000-4000-8000-000000000011','RLS type A'),
 ('00000000-0000-4000-8000-000000000012','RLS type B');
insert into public.department_features(department_id,feature_code,is_enabled) values
 ('00000000-0000-4000-8000-000000000011','equipment_readiness',true),
 ('00000000-0000-4000-8000-000000000012','equipment_readiness',true);
insert into public.pilot_range_workspaces(department_id) values
 ('00000000-0000-4000-8000-000000000011'),('00000000-0000-4000-8000-000000000012');

insert into public.department_membership_roles(department_id,user_id,role_code) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','administrator');
insert into public.off_duty_firearm_requests(id,department_id,officer_user_id,make,model,firearm_type,serial_number,caliber) values('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Synthetic','Test','Handgun','synthetic-probe','9mm');
select public.record_off_duty_firearm_inspection('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',current_date,'Pass','Disposable local');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.firearms(department_id,make,model,serial_number,firearm_type,caliber,condition_status,is_active,created_by) values('00000000-0000-4000-8000-000000000011','Synthetic','Test','synthetic-probe','handgun','9mm','In Service',true,'00000000-0000-4000-8000-000000000001');
do $$ declare f uuid;begin
 select id into f from public.firearms where serial_number='synthetic-probe';
 insert into public.firearm_assignments(department_id,firearm_id,assigned_to_user_id,condition_at_issue) values('00000000-0000-4000-8000-000000000011',f,'00000000-0000-4000-8000-000000000001','In Service');
 insert into public.firearm_inspections(department_id,firearm_id,inspection_date,inspected_by_user_id,inspection_type,result) values('00000000-0000-4000-8000-000000000011',f,current_date,'00000000-0000-4000-8000-000000000001','Routine','Pass') returning id into f;
 insert into public.firearm_inspection_items(inspection_id,label,status) values(f,'Synthetic checklist','Pass');
end $$;
reset role;
insert into public.certification_types(id,department_id,name) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011','Local inspection credential');
insert into public.department_certification_capabilities(department_id,capability_code,certification_type_id)
 values('00000000-0000-4000-8000-000000000011','perform_firearm_inspections','00000000-0000-4000-8000-000000000031');
do $$ begin
 begin
  insert into public.department_certification_capabilities(department_id,capability_code,certification_type_id)
   values('00000000-0000-4000-8000-000000000012','perform_firearm_inspections','00000000-0000-4000-8000-000000000031');
  raise exception 'Cross-tenant certification link accepted';
 exception when foreign_key_violation then null;
 end;
end $$;
set local role authenticated;
do $$ begin
 if (select count(*) from public.department_certification_capabilities) <> 1 then raise exception 'Capability member read failed'; end if;
 begin
  update public.department_certification_capabilities set is_active=false;
  raise exception 'Direct client policy mutation accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
delete from public.department_membership_roles where department_id='00000000-0000-4000-8000-000000000011' and user_id='00000000-0000-4000-8000-000000000001';
insert into public.department_membership_roles(department_id,user_id,role_code) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','officer');
set local role authenticated;
do $$ begin
 if (select count(*) from public.firearm_inspection_items) <> 1 then raise exception 'Own assigned firearm checklist read failed'; end if;
 begin
  insert into public.firearm_inspection_items(inspection_id,label,status) select id,'Forbidden non-manager','Pass' from public.firearm_inspections limit 1;
  raise exception 'Non-manager checklist write accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
