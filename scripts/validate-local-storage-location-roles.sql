-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger. Storage-location management with real role
-- assignments (database/aws/028, 034, 064): Administrators and Armorers may
-- create, rename and deactivate their agency's locations; a role holding only
-- manage_firearms, an officer and another agency's armorer may not. The agency
-- is created after 064, so it also proves new agencies inherit the default.
begin;
insert into auth.users(id,email) values
 ('05500000-0000-4000-8000-0000000000a1','sl-admin@example.invalid'),
 ('05500000-0000-4000-8000-0000000000a2','sl-armorer@example.invalid'),
 ('05500000-0000-4000-8000-0000000000a3','sl-firearms-only@example.invalid'),
 ('05500000-0000-4000-8000-0000000000a4','sl-officer@example.invalid'),
 ('05500000-0000-4000-8000-0000000000b1','sl-armorer-b@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'sl-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values
 ('05500000-0000-4000-8000-00000000000a','Storage roles A','local-sl-a'),
 ('05500000-0000-4000-8000-00000000000b','Storage roles B','local-sl-b');
insert into public.roles(code,display_name) values ('sl_firearms_only','Firearms only') on conflict do nothing;
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('05500000-0000-4000-8000-00000000000a','sl_firearms_only','manage_firearms') on conflict do nothing;
insert into public.department_memberships(department_id,user_id,is_active) values
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a1',true),
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a2',true),
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a3',true),
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a4',true),
 ('05500000-0000-4000-8000-00000000000b','05500000-0000-4000-8000-0000000000b1',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a1','administrator'),
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a2','armorer'),
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a3','sl_firearms_only'),
 ('05500000-0000-4000-8000-00000000000a','05500000-0000-4000-8000-0000000000a4','officer'),
 ('05500000-0000-4000-8000-00000000000b','05500000-0000-4000-8000-0000000000b1','armorer');

set local session authorization tracepoint_runtime;
set local role authenticated;

do $$
declare location uuid; admin_location uuid; refused boolean;
begin
 -- The Armorer creates, renames and deactivates a location.
 perform set_config('tracepoint.subject_id','05500000-0000-4000-8000-0000000000a2',true), set_config('tracepoint.department_id','05500000-0000-4000-8000-00000000000a',true);
 location := public.create_firearm_storage_location('Armory vault','Main');
 perform public.update_firearm_storage_location(location,'Armory vault 1','Main');
 perform public.deactivate_firearm_storage_location(location);
 -- The Administrator creates one.
 perform set_config('tracepoint.subject_id','05500000-0000-4000-8000-0000000000a1',true);
 admin_location := public.create_firearm_storage_location('Sergeant locker',null);
 -- A role with only manage_firearms, and an officer, are refused.
 foreach location in array array['05500000-0000-4000-8000-0000000000a3','05500000-0000-4000-8000-0000000000a4']::uuid[] loop
  perform set_config('tracepoint.subject_id',location::text,true);
  refused := false;
  begin
   perform public.create_firearm_storage_location('Not allowed',null);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'storage-location management allowed for %', location; end if;
 end loop;
 -- Another agency's armorer cannot change this agency's location.
 perform set_config('tracepoint.subject_id','05500000-0000-4000-8000-0000000000b1',true), set_config('tracepoint.department_id','05500000-0000-4000-8000-00000000000b',true);
 refused := false;
 begin
  perform public.update_firearm_storage_location(admin_location,'Taken over',null);
 exception when others then refused := true;
 end;
 if not refused then raise exception 'cross-agency storage-location update allowed'; end if;
 -- Read back as agency A (row-level security hides A's rows from B).
 perform set_config('tracepoint.subject_id','05500000-0000-4000-8000-0000000000a1',true), set_config('tracepoint.department_id','05500000-0000-4000-8000-00000000000a',true);
 if (select name from public.firearm_storage_locations where id = admin_location) is distinct from 'Sergeant locker' then
  raise exception 'cross-agency update changed the location';
 end if;
end $$;
rollback;
