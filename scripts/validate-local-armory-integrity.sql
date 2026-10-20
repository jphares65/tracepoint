-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers database/aws/052:
-- nobody decides their own off-duty request, reviews or reinstates their own
-- personal rifle, or certifies an ammunition count they submitted; a failed
-- off-duty inspection marks the request Non-Compliant.
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
  ('reviewer records rifle history for its current status', lieutenant, format($s$insert into public.personal_rifle_status_history(department_id,personal_rifle_id,actor_user_id,from_status,to_status,action) values (%L,%L,%L,'Pending Armorer Review','Pending Chief Approval','Armorer Approved')$s$, '0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000002a1',lieutenant), 'ok'),
  ('reviewer records rifle history for another status', lieutenant, format($s$insert into public.personal_rifle_status_history(department_id,personal_rifle_id,actor_user_id,from_status,to_status,action) values (%L,%L,%L,'Pending Chief Approval','Approved','Chief Approved')$s$, '0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000002a1',lieutenant), '42501'),
  ('member without rifle permission records rifle history', officer, format($s$insert into public.personal_rifle_status_history(department_id,personal_rifle_id,actor_user_id,from_status,to_status,action) values (%L,%L,%L,'Pending Armorer Review','Pending Chief Approval','Armorer Approved')$s$, '0e520000-0000-4000-8000-00000000000a','0e520000-0000-4000-8000-0000000002a1',officer), '42501'),
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
reset role;
reset session authorization;
rollback;
