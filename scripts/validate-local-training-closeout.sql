-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-training-record-visibility.sql). Covers database/aws/050:
-- closeout records the credentials it supersedes and reopen restores exactly
-- those (TRN-27); Completed/Passed requires attendance Present (TRN-04); the
-- issue date is the event's start date in the department time zone (TRN-02).
begin;
insert into auth.users(id,email) values
 ('0e500000-0000-4000-8000-0000000000a1','b7-officer-1@example.invalid'),
 ('0e500000-0000-4000-8000-0000000000a2','b7-officer-2@example.invalid'),
 ('0e500000-0000-4000-8000-0000000000a3','b7-training-manager@example.invalid'),
 ('0e500000-0000-4000-8000-0000000000b1','b7-officer-b@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'b7-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug,timezone) values
 ('0e500000-0000-4000-8000-00000000000a','B7 tenant A','local-b7-a','America/Los_Angeles'),
 ('0e500000-0000-4000-8000-00000000000b','B7 tenant B','local-b7-b','America/New_York');
delete from public.department_role_permissions where department_id in ('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-00000000000b');
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a1',true),
 ('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a2',true),
 ('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a3',true),
 ('0e500000-0000-4000-8000-00000000000b','0e500000-0000-4000-8000-0000000000b1',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a1','officer'),
 ('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a2','officer'),
 ('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a3','instructor'),
 ('0e500000-0000-4000-8000-00000000000b','0e500000-0000-4000-8000-0000000000b1','officer');
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0e500000-0000-4000-8000-00000000000a','instructor','manage_training');
insert into public.certification_types(id,department_id,name,expiration_required,default_valid_days) values
 ('0e500000-0000-4000-8000-0000000007a1','0e500000-0000-4000-8000-00000000000a','CPR',true,730),
 ('0e500000-0000-4000-8000-0000000007a2','0e500000-0000-4000-8000-00000000000a','First Aid',false,null),
 ('0e500000-0000-4000-8000-0000000007b1','0e500000-0000-4000-8000-00000000000b','CPR',true,730);
-- Officer 1: a current CPR credential (to be superseded), an older one that is
-- already inactive, and a First Aid credential. Tenant B's officer holds CPR.
insert into public.training_certifications(id,department_id,user_id,certification_type_id,certification_title,issue_date,expiration_date,is_active) values
 ('0e500000-0000-4000-8000-0000000008a1','0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a1','0e500000-0000-4000-8000-0000000007a1','CPR','2025-01-10','2027-01-10',true),
 ('0e500000-0000-4000-8000-0000000008a0','0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a1','0e500000-0000-4000-8000-0000000007a1','CPR','2023-01-10','2025-01-10',false),
 ('0e500000-0000-4000-8000-0000000008a2','0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000000a1','0e500000-0000-4000-8000-0000000007a2','First Aid','2025-02-01',null,true),
 ('0e500000-0000-4000-8000-0000000008b1','0e500000-0000-4000-8000-00000000000b','0e500000-0000-4000-8000-0000000000b1','0e500000-0000-4000-8000-0000000007b1','CPR','2025-01-10','2027-01-10',true);
-- 18:00 Pacific on 24 Oct 2026 is 01:00 UTC on 25 Oct.
insert into public.agency_training_events(id,department_id,title,starts_at,status,certification_type_id) values
 ('0e500000-0000-4000-8000-0000000002a1','0e500000-0000-4000-8000-00000000000a','CPR recertification','2026-10-25T01:00:00Z','in_progress','0e500000-0000-4000-8000-0000000007a1');
insert into public.agency_training_attendees(id,department_id,event_id,user_id,attendance_status,outcome_status) values
 ('0e500000-0000-4000-8000-0000000003a1','0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000002a1','0e500000-0000-4000-8000-0000000000a1','present','passed'),
 ('0e500000-0000-4000-8000-0000000003a2','0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000002a1','0e500000-0000-4000-8000-0000000000a2','no_show','completed');

set local session authorization tracepoint_runtime;
set local role authenticated;

-- A no-show recorded as Completed is refused; once corrected, closeout runs.
do $$
begin
 perform set_config('tracepoint.subject_id','0e500000-0000-4000-8000-0000000000a3',true), set_config('tracepoint.department_id','0e500000-0000-4000-8000-00000000000a',true);
 begin
  perform public.close_agency_training_event('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000002a1','0e500000-0000-4000-8000-0000000000a3');
  raise exception 'closeout accepted a no-show marked Completed';
 exception when others then
  if sqlerrm not like '%attendance Present%' then raise; end if;
 end;
 update public.agency_training_attendees set outcome_status='incomplete' where id='0e500000-0000-4000-8000-0000000003a2';
 perform public.close_agency_training_event('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000002a1','0e500000-0000-4000-8000-0000000000a3');
end $$;
reset role;
reset session authorization;

do $$
declare issued record;
begin
 select * into issued from public.training_certifications where source_training_attendee_id='0e500000-0000-4000-8000-0000000003a1';
 if issued.id is null or not issued.is_active then raise exception 'Closeout did not issue an active credential'; end if;
 if issued.issue_date <> date '2026-10-24' then raise exception 'Issue date % is not the Pacific event date 2026-10-24', issued.issue_date; end if;
 if issued.expiration_date <> date '2026-10-24' + 730 then raise exception 'Expiration % is not issue date + 730', issued.expiration_date; end if;
 if exists(select 1 from public.training_certifications where user_id='0e500000-0000-4000-8000-0000000000a2') then raise exception 'A no-show received a credential'; end if;
 if (select (is_active, superseded_by_training_event_id) from public.training_certifications where id='0e500000-0000-4000-8000-0000000008a1')
    is distinct from (false, '0e500000-0000-4000-8000-0000000002a1'::uuid) then raise exception 'Closeout did not record the credential it superseded'; end if;
 if (select superseded_by_training_event_id from public.training_certifications where id='0e500000-0000-4000-8000-0000000008a0') is not null then raise exception 'Closeout claimed an already-inactive credential'; end if;
 if not (select is_active from public.training_certifications where id='0e500000-0000-4000-8000-0000000008a2') then raise exception 'Closeout deactivated a credential of another type'; end if;
 if not (select is_active from public.training_certifications where id='0e500000-0000-4000-8000-0000000008b1') then raise exception 'Closeout touched another tenant'; end if;
end $$;

set local session authorization tracepoint_runtime;
set local role authenticated;
do $$
begin
 perform set_config('tracepoint.subject_id','0e500000-0000-4000-8000-0000000000a3',true), set_config('tracepoint.department_id','0e500000-0000-4000-8000-00000000000a',true);
 perform public.reopen_agency_training_event('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000002a1','0e500000-0000-4000-8000-0000000000a3','Typo in roster');
end $$;
reset role;
reset session authorization;

-- Reopen: the event's credential is withdrawn and the superseded one restored;
-- the credential that was already inactive stays inactive.
do $$
begin
 if (select is_active from public.training_certifications where source_training_attendee_id='0e500000-0000-4000-8000-0000000003a1') then raise exception 'Reopen left the issued credential active'; end if;
 if (select (is_active, superseded_by_training_event_id) from public.training_certifications where id='0e500000-0000-4000-8000-0000000008a1')
    is distinct from (true, null::uuid) then raise exception 'Reopen did not restore the superseded credential'; end if;
 if (select is_active from public.training_certifications where id='0e500000-0000-4000-8000-0000000008a0') then raise exception 'Reopen reactivated a credential it had not superseded'; end if;
 if (select count(*) from public.training_certifications where department_id='0e500000-0000-4000-8000-00000000000a' and user_id='0e500000-0000-4000-8000-0000000000a1' and certification_type_id='0e500000-0000-4000-8000-0000000007a1' and is_active) <> 1 then raise exception 'Officer should hold exactly one active CPR credential after reopen'; end if;
end $$;

-- Closing again supersedes the restored credential again.
set local session authorization tracepoint_runtime;
set local role authenticated;
do $$
begin
 perform set_config('tracepoint.subject_id','0e500000-0000-4000-8000-0000000000a3',true), set_config('tracepoint.department_id','0e500000-0000-4000-8000-00000000000a',true);
 perform public.close_agency_training_event('0e500000-0000-4000-8000-00000000000a','0e500000-0000-4000-8000-0000000002a1','0e500000-0000-4000-8000-0000000000a3');
end $$;
reset role;
reset session authorization;
do $$
begin
 if (select (is_active, superseded_by_training_event_id) from public.training_certifications where source_training_attendee_id='0e500000-0000-4000-8000-0000000003a1')
    is distinct from (true, null::uuid) then raise exception 'Re-closeout did not reissue the credential'; end if;
 if (select (is_active, superseded_by_training_event_id) from public.training_certifications where id='0e500000-0000-4000-8000-0000000008a1')
    is distinct from (false, '0e500000-0000-4000-8000-0000000002a1'::uuid) then raise exception 'Re-closeout did not supersede the prior credential again'; end if;
end $$;
rollback;
