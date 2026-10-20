-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers database/aws/052:
-- nobody decides their own off-duty request, reviews or reinstates their own
-- personal rifle, or certifies an ammunition count they submitted; a failed
-- off-duty inspection marks the request Non-Compliant. Also B8a (052, 053):
-- rifle and firearm status history is written only by the database, with the
-- change, as the signed-in actor, and cannot be changed; armory staff see the
-- names the armory shows without reading profiles; an inspection manager can
-- record an off-duty inspection without reading the request.
begin;
insert into auth.users(id,email) values
 ('0e520000-0000-4000-8000-0000000000b1','ai-chief@example.invalid'),
 ('0e520000-0000-4000-8000-0000000000b2','ai-lieutenant@example.invalid'),
 ('0e520000-0000-4000-8000-0000000000b3','ai-armorer@example.invalid'),
 ('0e520000-0000-4000-8000-0000000000b4','ai-officer@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'ai-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values ('0e520000-0000-4000-8000-00000000000a','AI tenant A','local-ai-a');
delete from public.department_role_permissions where department_id='0e520000-0000-4000-8000-00000000000a';
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b1',true),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b2',true),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b3',true),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b4',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b1','chief'),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b2','chief'),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b3','armorer'),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b4','officer');
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0e520000-0000-4000-8000-00000000000a','chief','review_off_duty_requests'),
 ('0e520000-0000-4000-8000-00000000000a','chief','submit_off_duty_requests'),
 ('0e520000-0000-4000-8000-00000000000a','chief','approve_personal_rifles'),
 ('0e520000-0000-4000-8000-00000000000a','chief','manage_firearms'),
 ('0e520000-0000-4000-8000-00000000000a','armorer','manage_firearms'),
 ('0e520000-0000-4000-8000-00000000000a','armorer','manage_inspections');
insert into public.off_duty_firearm_requests(id,department_id,officer_user_id,make,model,firearm_type,serial_number,caliber,request_status) values
 ('0e520000-0000-4000-8000-0000000001a1','0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b1','Glock','43','Handgun','AI-OD-1','9mm','Pending Command Review'),
 ('0e520000-0000-4000-8000-0000000001a2','0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b1','Glock','48','Handgun','AI-OD-2','9mm','Approved');
insert into public.personal_rifles(id,department_id,owner_user_id,manufacturer,model,serial_number,caliber,status) values
 ('0e520000-0000-4000-8000-0000000002a1','0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b1','Colt','M4','AI-PR-1','5.56','Pending Chief Approval'),
 ('0e520000-0000-4000-8000-0000000002a2','0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b1','Colt','M4','AI-PR-2','5.56','Suspended');
insert into auth.users(id,email) values
 ('0e520000-0000-4000-8000-0000000000b5','ai-inspector@example.invalid'),
 ('0e520000-0000-4000-8000-0000000000b6','ai-keeper@example.invalid'),
 ('0e520000-0000-4000-8000-0000000000b7','ai-other-armorer@example.invalid');
insert into public.profiles(id,full_name) values
 ('0e520000-0000-4000-8000-0000000000b5','ai-inspector'),('0e520000-0000-4000-8000-0000000000b6','ai-keeper'),('0e520000-0000-4000-8000-0000000000b7','ai-other-armorer')
on conflict(id) do update set full_name=excluded.full_name;
update public.profiles set full_name='Olive Officer' where id='0e520000-0000-4000-8000-0000000000b4';
insert into public.departments(id,name,slug) values ('0e520000-0000-4000-8000-00000000000b','AI tenant B','local-ai-b');
delete from public.department_role_permissions where department_id='0e520000-0000-4000-8000-00000000000b';
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b5',true),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b6',true),
 ('0e520000-0000-4000-8000-00000000000b','0e520000-0000-4000-8000-0000000000b7',true);
update public.department_memberships set badge_number='4410' where department_id='0e520000-0000-4000-8000-00000000000a' and user_id='0e520000-0000-4000-8000-0000000000b4';
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b5','supervisor'),
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b6','mechanic'),
 ('0e520000-0000-4000-8000-00000000000b','0e520000-0000-4000-8000-0000000000b7','armorer');
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0e520000-0000-4000-8000-00000000000a','supervisor','manage_inspections'),
 ('0e520000-0000-4000-8000-00000000000a','mechanic','manage_firearms'),
 ('0e520000-0000-4000-8000-00000000000b','armorer','manage_firearms'),
 ('0e520000-0000-4000-8000-00000000000b','armorer','manage_inspections');
insert into public.firearms(id,department_id,make,model,serial_number,caliber,firearm_type,condition_status) values
 ('0e520000-0000-4000-8000-0000000004f1','0e520000-0000-4000-8000-00000000000a','Glock','17','AI-F-1','9mm','handgun','In Service'),
 ('0e520000-0000-4000-8000-0000000004f2','0e520000-0000-4000-8000-00000000000a','Glock','17','AI-F-2','9mm','handgun','In Service');
insert into public.firearm_assignments(department_id,firearm_id,assigned_to_user_id,assigned_by_user_id) values
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000004f1','0e520000-0000-4000-8000-0000000000b4','0e520000-0000-4000-8000-0000000000b3');
insert into public.firearm_status_history(department_id,firearm_id,old_status,new_status,changed_by_user_id,notes) values
 ('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000004f2',null,'In Service','0e520000-0000-4000-8000-0000000000b3','Seed');
insert into public.personal_rifles(id,department_id,owner_user_id,manufacturer,model,serial_number,caliber,status) values
 ('0e520000-0000-4000-8000-0000000002a3','0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b4','Colt','M4','AI-PR-3','5.56','Pending Armorer Review'),
 ('0e520000-0000-4000-8000-0000000002a4','0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000000b4','Colt','M4','AI-PR-4','5.56','Draft');
-- Lets the atomicity case make the history insert fail; rolled back below.
alter table public.personal_rifle_status_history add constraint ai_force_history_failure check (notes is distinct from 'force history failure');
insert into public.ammunition_reconciliations(id,department_id,cycle_name,cycle_year,cycle_start,cycle_end,status,created_by,submitted_by,submitted_at) values
 ('0e520000-0000-4000-8000-0000000003a1','0e520000-0000-4000-8000-00000000000a','Spring',2026,'2026-04-01','2026-06-30','Submitted','0e520000-0000-4000-8000-0000000000b3','0e520000-0000-4000-8000-0000000000b3',now());

-- Runs a statement as the subject and rolls it back; returns the error code,
-- 'ok', or 'no rows' when a policy filtered the row.
create function pg_temp.ai_try(subject text, statement text) returns text language plpgsql as $$
declare touched int;
begin
 perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id','0e520000-0000-4000-8000-00000000000a',true);
 begin
  execute statement;
  get diagnostics touched = row_count;
  raise exception using errcode = 'P0099', message = case when touched >= 1 then 'ok' else 'no rows' end;
 exception
  when sqlstate 'P0099' then return sqlerrm;
  when others then return sqlstate;
 end;
end $$;
grant execute on function pg_temp.ai_try(text,text) to authenticated;
-- The same, in the given agency (cross-agency cases).
create function pg_temp.ai_try_in(subject text, agency text, statement text) returns text language plpgsql as $$
declare touched int;
begin
 perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id',agency,true);
 begin
  execute statement;
  get diagnostics touched = row_count;
  raise exception using errcode = 'P0099', message = case when touched >= 1 then 'ok' else 'no rows' end;
 exception
  when sqlstate 'P0099' then return sqlerrm;
  when others then return sqlstate;
 end;
end $$;
grant execute on function pg_temp.ai_try_in(text,text,text) to authenticated;

set local session authorization tracepoint_runtime;
set local role authenticated;

do $$
declare chief text := '0e520000-0000-4000-8000-0000000000b1'; lieutenant text := '0e520000-0000-4000-8000-0000000000b2';
 armorer text := '0e520000-0000-4000-8000-0000000000b3'; officer text := '0e520000-0000-4000-8000-0000000000b4'; label text; subject text; statement text; expected text; actual text;
begin
 for label, subject, statement, expected in values
  ('reviewer approves own off-duty request', chief, format($s$select public.apply_off_duty_firearm_decision(%L,%L,%L,'Chief','Chief','Approve',null,current_date,current_date+365)$s$, '0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000001a1',chief), '42501'),
  ('reviewer denies own off-duty request', chief, format($s$select public.apply_off_duty_firearm_decision(%L,%L,%L,'Chief','Chief','Deny','x')$s$, '0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000001a1',chief), '42501'),
  ('reviewer approves own request by direct update', chief, format($s$update public.off_duty_firearm_requests set request_status='Approved',authorization_status='Authorized',reviewed_by_user_id=%L where id=%L$s$, chief, '0e520000-0000-4000-8000-0000000001a1'), '42501'),
  ('another reviewer approves the request', lieutenant, format($s$select public.apply_off_duty_firearm_decision(%L,%L,%L,'Lt','Chief','Approve',null,current_date,current_date+365)$s$, '0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000001a1',lieutenant), 'ok'),
  ('owner approves own rifle as chief', chief, format($s$update public.personal_rifles set status='Approved',chief_reviewed_by=%L where id=%L$s$, chief, '0e520000-0000-4000-8000-0000000002a1'), '42501'),
  ('owner records own armorer review', chief, format($s$update public.personal_rifles set status='Correction Requested',armorer_reviewed_by=%L where id=%L$s$, chief, '0e520000-0000-4000-8000-0000000002a1'), '42501'),
  ('owner reinstates own suspended rifle', chief, format($s$update public.personal_rifles set status='Approved' where id=%L$s$, '0e520000-0000-4000-8000-0000000002a2'), '42501'),
  ('another reviewer approves the rifle', lieutenant, format($s$update public.personal_rifles set status='Approved',chief_reviewed_by=%L where id=%L$s$, lieutenant, '0e520000-0000-4000-8000-0000000002a1'), 'ok'),
  ('another reviewer reinstates the rifle', lieutenant, format($s$update public.personal_rifles set status='Approved' where id=%L$s$, '0e520000-0000-4000-8000-0000000002a2'), 'ok'),
  ('submitter certifies own ammunition count', armorer, format($s$update public.ammunition_reconciliations set status='Certified',certified_by=%L,certified_at=now() where id=%L$s$, armorer, '0e520000-0000-4000-8000-0000000003a1'), '42501'),
  ('another armorer certifies the count', chief, format($s$update public.ammunition_reconciliations set status='Certified',certified_by=%L,certified_at=now() where id=%L$s$, chief, '0e520000-0000-4000-8000-0000000003a1'), 'ok')
 loop
  actual := pg_temp.ai_try(subject, statement);
  if actual is distinct from expected then
   raise exception 'Armory integrity check "%" returned %, expected %', label, actual, expected;
  end if;
 end loop;
end $$;

-- A failed off-duty inspection marks the approved request Non-Compliant.
do $$
declare compliance text;
begin
 perform set_config('tracepoint.subject_id','0e520000-0000-4000-8000-0000000000b3',true), set_config('tracepoint.department_id','0e520000-0000-4000-8000-00000000000a',true);
 perform public.record_off_duty_firearm_inspection('0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000001a2','0e520000-0000-4000-8000-0000000000b3',current_date,'Fail','Cracked slide');
 perform set_config('tracepoint.subject_id','0e520000-0000-4000-8000-0000000000b1',true);
 select compliance_status into compliance from public.off_duty_firearm_requests where id='0e520000-0000-4000-8000-0000000001a2';
 if compliance is distinct from 'Non-Compliant' then
  raise exception 'A failed off-duty inspection left compliance %', compliance;
 end if;
end $$;
-- B8a: each statement runs as the subject in the given agency and is rolled
-- back. History is written only by the database; names and the off-duty
-- inspection need no wider reads; another agency is refused.
do $$
declare a text := '0e520000-0000-4000-8000-00000000000a'; b text := '0e520000-0000-4000-8000-00000000000b';
 chief text := '0e520000-0000-4000-8000-0000000000b1'; lieutenant text := '0e520000-0000-4000-8000-0000000000b2';
 armorer text := '0e520000-0000-4000-8000-0000000000b3'; officer text := '0e520000-0000-4000-8000-0000000000b4';
 inspector text := '0e520000-0000-4000-8000-0000000000b5'; keeper text := '0e520000-0000-4000-8000-0000000000b6'; other text := '0e520000-0000-4000-8000-0000000000b7';
 rifle text := '0e520000-0000-4000-8000-0000000002a1'; officer_rifle text := '0e520000-0000-4000-8000-0000000002a3';
 firearm text := '0e520000-0000-4000-8000-0000000004f2'; request text := '0e520000-0000-4000-8000-0000000001a2';
 label text; subject text; agency text; statement text; expected text; actual text;
begin
 for label, subject, agency, statement, expected in values
  ('reviewer inserts rifle history directly', lieutenant, a, format($s$insert into public.personal_rifle_status_history(department_id,personal_rifle_id,actor_user_id,from_status,to_status,action) values (%L,%L,%L,'Pending Armorer Review','Pending Chief Approval','Armorer Approved')$s$, a, rifle, lieutenant), '42501'),
  ('owner inserts history for own rifle without a transition', chief, a, format($s$insert into public.personal_rifle_status_history(department_id,personal_rifle_id,actor_user_id,from_status,to_status,action,created_at) values (%L,%L,%L,'Pending Chief Approval','Pending Chief Approval','Owner Saved Draft',now()-interval '1 year')$s$, a, rifle, chief), '42501'),
  ('reviewer changes a rifle history row', lieutenant, a, $s$update public.personal_rifle_status_history set notes='edited'$s$, '42501'),
  ('reviewer deletes rifle history', lieutenant, a, $s$delete from public.personal_rifle_status_history$s$, '42501'),
  ('armorer inserts firearm history directly', armorer, a, format($s$insert into public.firearm_status_history(department_id,firearm_id,old_status,new_status,changed_by_user_id,notes) values (%L,%L,'Out of Service','In Service',%L,'Inspection result Passed (inspection x).')$s$, a, firearm, armorer), '42501'),
  ('armorer changes a firearm history row', armorer, a, $s$update public.firearm_status_history set notes='edited'$s$, '42501'),
  ('armorer deletes firearm history', armorer, a, $s$delete from public.firearm_status_history$s$, '42501'),
  ('officer changes firearm status', officer, a, format($s$select public.change_firearm_status(%L,%L,'In Service','Out of Service','x')$s$, a, firearm), '42501'),
  ('armorer of another agency changes firearm status', other, b, format($s$select public.change_firearm_status(%L,%L,'In Service','Out of Service','x')$s$, a, firearm), '42501'),
  ('armorer of another agency claims agency A', other, a, format($s$select public.change_firearm_status(%L,%L,'In Service','Out of Service','x')$s$, a, firearm), '42501'),
  ('firearm status change to the same status', armorer, a, format($s$select public.change_firearm_status(%L,%L,'In Service','In Service','x')$s$, a, firearm), '22023'),
  ('armory keeper reads the holder profile directly', keeper, a, format($s$select 1 from public.profiles where id=%L$s$, officer), 'no rows'),
  ('armory keeper reads the holder membership directly', keeper, a, format($s$select 1 from public.department_memberships where user_id=%L$s$, officer), 'no rows'),
  ('officer looks up another member name', officer, a, format($s$select 1 from public.armory_member_identities(%L,array[%L]::uuid[])$s$, a, keeper), 'no rows'),
  ('inspection manager looks up a member who holds nothing', inspector, a, format($s$select 1 from public.armory_member_identities(%L,array[%L]::uuid[])$s$, a, keeper), 'no rows'),
  ('another agency looks up agency A names', other, b, format($s$select 1 from public.armory_member_identities(%L)$s$, a), 'no rows'),
  ('another agency claims agency A for names', other, a, format($s$select 1 from public.armory_member_identities(%L)$s$, a), 'no rows'),
  ('another agency updates an agency A rifle', other, b, format($s$update public.personal_rifles set status='Approved' where id=%L$s$, officer_rifle), 'no rows'),
  ('inspection manager reads the off-duty request directly', inspector, a, format($s$select 1 from public.off_duty_firearm_requests where id=%L$s$, request), 'no rows'),
  ('inspection manager records an off-duty inspection', inspector, a, format($s$select public.record_off_duty_firearm_inspection(%L,%L,%L,current_date,'Pass',null)$s$, a, request, inspector), 'ok'),
  ('off-duty inspection of a missing request', inspector, a, format($s$select public.record_off_duty_firearm_inspection(%L,%L,%L,current_date,'Pass',null)$s$, a, '0e520000-0000-4000-8000-0000000001ff', inspector), 'P0002'),
  ('officer records an off-duty inspection', officer, a, format($s$select public.record_off_duty_firearm_inspection(%L,%L,%L,current_date,'Pass',null)$s$, a, request, officer), '42501'),
  ('another agency records an inspection on agency A', other, b, format($s$select public.record_off_duty_firearm_inspection(%L,%L,%L,current_date,'Pass',null)$s$, a, request, other), '42501')
 loop
  actual := pg_temp.ai_try_in(subject, agency, statement);
  if actual is distinct from expected then
   raise exception 'Armory audit/access check "%" returned %, expected %', label, actual, expected;
  end if;
 end loop;
end $$;

-- A rifle change writes exactly one history row, in the same statement, as
-- the signed-in actor; no status change writes none; a failed history write
-- or a failed update leaves neither.
do $$
declare a text := '0e520000-0000-4000-8000-00000000000a';
 armorer uuid := '0e520000-0000-4000-8000-0000000000b3'; lieutenant uuid := '0e520000-0000-4000-8000-0000000000b2'; officer uuid := '0e520000-0000-4000-8000-0000000000b4';
 rifle uuid := '0e520000-0000-4000-8000-0000000002a3'; draft uuid := '0e520000-0000-4000-8000-0000000002a4'; created uuid;
 before_count int; after_count int; row record; status text; note text;
begin
 perform set_config('tracepoint.subject_id',armorer::text,true), set_config('tracepoint.department_id',a,true);
 select count(*) into before_count from public.personal_rifle_status_history where personal_rifle_id=rifle;
 update public.personal_rifles set status='Pending Chief Approval', armorer_reviewed_by=armorer, armorer_reviewed_at=now(),
   armorer_checklist='{"serial_verified":true}', inspection_date=current_date, qualification_verified=true, workflow_note='Looks good'
 where id=rifle;
 select count(*) into after_count from public.personal_rifle_status_history where personal_rifle_id=rifle;
 select * into row from public.personal_rifle_status_history where personal_rifle_id=rifle and action='Armorer Approved';
 if after_count <> before_count + 1 or row.actor_user_id is distinct from armorer or row.from_status <> 'Pending Armorer Review'
    or row.to_status <> 'Pending Chief Approval' or row.notes is distinct from 'Looks good' or row.metadata->>'qualificationVerified' <> 'true' then
  raise exception 'Armorer approval history was % rows, last %', after_count - before_count, to_jsonb(row);
 end if;
 select workflow_note into note from public.personal_rifles where id=rifle;
 if note is not null then raise exception 'workflow_note was stored: %', note; end if;

 update public.personal_rifles set armorer_decision_notes='Typo fixed' where id=rifle;
 select count(*) into before_count from public.personal_rifle_status_history where personal_rifle_id=rifle;
 if before_count <> after_count then raise exception 'An update without a status change wrote history'; end if;

 perform set_config('tracepoint.subject_id',lieutenant::text,true);
 begin
  update public.personal_rifles set status='Approved', chief_reviewed_by=lieutenant, workflow_note='force history failure' where id=rifle;
  raise exception 'The approval succeeded although its history row failed';
 exception when check_violation then null;
 end;
 begin
  update public.personal_rifles set status='Bogus', workflow_note='Invalid status' where id=rifle;
  raise exception 'An invalid status was stored';
 exception when check_violation then null;
 end;
 select r.status, (select count(*) from public.personal_rifle_status_history h where h.personal_rifle_id=rifle) into status, after_count
 from public.personal_rifles r where r.id=rifle;
 if status <> 'Pending Chief Approval' or after_count <> before_count then
  raise exception 'A failed change left status % and % history rows (expected %)', status, after_count, before_count;
 end if;

 perform set_config('tracepoint.subject_id',officer::text,true);
 select count(*) into before_count from public.personal_rifle_status_history where personal_rifle_id=draft;
 update public.personal_rifles set manufacturer='Colt' where id=draft;
 select count(*) into after_count from public.personal_rifle_status_history where personal_rifle_id=draft;
 if after_count <> before_count then raise exception 'A draft save that changed nothing wrote history'; end if;
 update public.personal_rifles set model='M4A1' where id=draft;
 update public.personal_rifles set status='Pending Armorer Review', submitted_at=now() where id=draft;
 select count(*) into after_count from public.personal_rifle_status_history
 where personal_rifle_id=draft and actor_user_id=officer
   and ((action='Owner Saved Draft' and from_status='Draft' and to_status='Draft')
     or (action='Owner Submitted' and from_status='Draft' and to_status='Pending Armorer Review'));
 if after_count <> 2 then raise exception 'Owner draft save and submit wrote % matching rows', after_count; end if;

 insert into public.personal_rifles(department_id,owner_user_id,manufacturer,model,serial_number,caliber,status)
 values (a::uuid,officer,'Ruger','AR-556','AI-PR-5','5.56','Draft') returning id into created;
 if (select count(*) from public.personal_rifle_status_history where personal_rifle_id=created and action='Draft Created'
       and actor_user_id=officer and from_status is null and to_status='Draft') <> 1 then
  raise exception 'A new rifle did not get its creation history row';
 end if;
end $$;

-- A firearm status change and its history row are one call; a stale change
-- writes nothing.
do $$
declare a text := '0e520000-0000-4000-8000-00000000000a'; armorer uuid := '0e520000-0000-4000-8000-0000000000b3';
 firearm uuid := '0e520000-0000-4000-8000-0000000004f2'; changed boolean; history_count int; current_status text; row record;
begin
 perform set_config('tracepoint.subject_id',armorer::text,true), set_config('tracepoint.department_id',a,true);
 changed := public.change_firearm_status(a::uuid,firearm,'In Service','Out of Service','Cracked frame');
 select * into row from public.firearm_status_history where firearm_id=firearm and new_status='Out of Service';
 if not changed or row.changed_by_user_id is distinct from armorer or row.old_status <> 'In Service' or row.notes <> 'Cracked frame' then
  raise exception 'Firearm status change returned % with history %', changed, to_jsonb(row);
 end if;
 changed := public.change_firearm_status(a::uuid,firearm,'In Service','Maintenance','stale');
 select condition_status, (select count(*) from public.firearm_status_history h where h.firearm_id=firearm) into current_status, history_count
 from public.firearms where id=firearm;
 if changed or current_status <> 'Out of Service' or history_count <> 2 then
  raise exception 'A stale firearm status change returned %, status %, % history rows', changed, current_status, history_count;
 end if;
end $$;

-- An armorer with manage_firearms only sees the holder's name and badge and
-- the active roster; an inspection manager sees holders, not the roster.
do $$
declare a text := '0e520000-0000-4000-8000-00000000000a'; officer uuid := '0e520000-0000-4000-8000-0000000000b4';
 keeper uuid := '0e520000-0000-4000-8000-0000000000b6'; inspector uuid := '0e520000-0000-4000-8000-0000000000b5'; row record; roster int;
begin
 perform set_config('tracepoint.subject_id',keeper::text,true), set_config('tracepoint.department_id',a,true);
 select * into row from public.armory_member_identities(a::uuid) where user_id=officer;
 select count(*) into roster from public.armory_member_identities(a::uuid);
 if row.full_name is distinct from 'Olive Officer' or row.badge_number is distinct from '4410' or not row.is_active or roster < 6 then
  raise exception 'Armory keeper saw holder % and % roster rows', to_jsonb(row), roster;
 end if;
 perform set_config('tracepoint.subject_id',inspector::text,true);
 if not exists (select 1 from public.armory_member_identities(a::uuid) where user_id=officer and full_name='Olive Officer')
    or exists (select 1 from public.armory_member_identities(a::uuid) where user_id=keeper) then
  raise exception 'Inspection manager names were not limited to holders';
 end if;
end $$;
reset role;
reset session authorization;
rollback;
