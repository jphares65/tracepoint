-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers database/aws/048: an
-- officer reads only their own training, certification, range and
-- qualification records; other officers' records need a mapped permission.
-- Each role holds one permission so every row of the matrix is attributable.
begin;
insert into auth.users(id,email) values
 ('0e480000-0000-4000-8000-0000000000a1','tv-officer-1@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a2','tv-officer-2@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a3','tv-cert-manager@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a4','tv-training-manager@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a5','tv-scorer@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a6','tv-qualification-manager@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a7','tv-command@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a8','tv-analytics@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000a9','tv-admin@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000aa','tv-inactive-officer@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000b1','tv-officer-b@example.invalid'),
 ('0e480000-0000-4000-8000-0000000000b2','tv-admin-b@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'tv-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values
 ('0e480000-0000-4000-8000-00000000000a','TV tenant A','local-tv-a'),
 ('0e480000-0000-4000-8000-00000000000b','TV tenant B','local-tv-b');
delete from public.department_role_permissions where department_id in ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-00000000000b');
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a1',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a2',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a3',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a4',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a5',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a6',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a7',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a8',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a9',true),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000aa',false),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000000b1',true),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000000b2',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a1','officer'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a2','officer'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a3','supervisor'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a4','instructor'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a5','range_master'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a6','armorer'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a7','command_staff'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a8','chief'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a9','administrator'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000aa','officer'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000000b1','officer'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000000b2','administrator');
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0e480000-0000-4000-8000-00000000000a','supervisor','manage_certifications'),
 ('0e480000-0000-4000-8000-00000000000a','instructor','manage_training'),
 ('0e480000-0000-4000-8000-00000000000a','range_master','score_range_days'),
 ('0e480000-0000-4000-8000-00000000000a','armorer','manage_qualifications'),
 ('0e480000-0000-4000-8000-00000000000a','command_staff','view_command_dashboard'),
 ('0e480000-0000-4000-8000-00000000000a','chief','view_analytics'),
 ('0e480000-0000-4000-8000-00000000000b','officer','view_analytics');
-- Two officers' records in A (officer 1 and officer 2), one officer's in B.
insert into public.training_certifications(department_id,user_id,certification_title) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a1','Officer 1 cert'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a2','Officer 2 cert'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000aa','Inactive officer cert'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000000b1','Officer B cert');
insert into public.agency_training_courses(id,department_id,canonical_title) values
 ('0e480000-0000-4000-8000-0000000001a1','0e480000-0000-4000-8000-00000000000a','In-service'),
 ('0e480000-0000-4000-8000-0000000001b1','0e480000-0000-4000-8000-00000000000b','In-service B');
insert into public.agency_training_events(id,department_id,title,starts_at) values
 ('0e480000-0000-4000-8000-0000000002a1','0e480000-0000-4000-8000-00000000000a','In-service',now()),
 ('0e480000-0000-4000-8000-0000000002b1','0e480000-0000-4000-8000-00000000000b','In-service B',now());
insert into public.agency_training_attendees(id,department_id,event_id,user_id,score_text,remedial_notes) values
 ('0e480000-0000-4000-8000-0000000003a1','0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000002a1','0e480000-0000-4000-8000-0000000000a1','95','none'),
 ('0e480000-0000-4000-8000-0000000003a2','0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000002a1','0e480000-0000-4000-8000-0000000000a2','61','retest'),
 ('0e480000-0000-4000-8000-0000000003b1','0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000002b1','0e480000-0000-4000-8000-0000000000b1','80',null);
insert into public.agency_training_certificates(department_id,event_id,attendee_id,user_id,certificate_number,certificate_title) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000002a1','0e480000-0000-4000-8000-0000000003a1','0e480000-0000-4000-8000-0000000000a1','TV-1','In-service'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000002a1','0e480000-0000-4000-8000-0000000003a2','0e480000-0000-4000-8000-0000000000a2','TV-2','In-service'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000002b1','0e480000-0000-4000-8000-0000000003b1','0e480000-0000-4000-8000-0000000000b1','TV-B','In-service B');
insert into public.agency_training_requirements(id,department_id,course_id,requirement_name) values
 ('0e480000-0000-4000-8000-0000000004a1','0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000001a1','Annual'),
 ('0e480000-0000-4000-8000-0000000004b1','0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000001b1','Annual B');
insert into public.agency_training_requirement_members(department_id,requirement_id,user_id) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000004a1','0e480000-0000-4000-8000-0000000000a1'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000004a1','0e480000-0000-4000-8000-0000000000a2'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000004b1','0e480000-0000-4000-8000-0000000000b1');
insert into public.range_days(id,department_id,title,range_date,location,lead_instructor_user_id,created_by_user_id) values
 ('0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-00000000000a','Spring range',current_date,'Range','0e480000-0000-4000-8000-0000000000a5','0e480000-0000-4000-8000-0000000000a5'),
 ('0e480000-0000-4000-8000-0000000005b1','0e480000-0000-4000-8000-00000000000b','B range',current_date,'Range','0e480000-0000-4000-8000-0000000000b2','0e480000-0000-4000-8000-0000000000b2');
insert into public.range_day_drills(id,department_id,range_day_id,name,category,scoring_format) values
 ('0e480000-0000-4000-8000-0000000006a1','0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000005a1','Qual','qualification','points'),
 ('0e480000-0000-4000-8000-0000000006b1','0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000005b1','Qual B','qualification','points');
insert into public.qualification_results(department_id,officer_user_id,qualification_date,score,passed,record_origin,historical_course_name) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a1',current_date,95,true,'historical_import','Imported'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a2',current_date,71,false,'historical_import','Imported'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000000b1',current_date,88,true,'historical_import','Imported');
insert into public.drill_run_results(department_id,range_day_id,range_day_drill_id,officer_user_id,run_number,scoring_format_snapshot,instructor_user_id,notes) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-0000000006a1','0e480000-0000-4000-8000-0000000000a1',1,'points','0e480000-0000-4000-8000-0000000000a5','fine'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-0000000006a1','0e480000-0000-4000-8000-0000000000a2',1,'points','0e480000-0000-4000-8000-0000000000a5','remedial'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000005b1','0e480000-0000-4000-8000-0000000006b1','0e480000-0000-4000-8000-0000000000b1',1,'points','0e480000-0000-4000-8000-0000000000b2',null);
insert into public.range_day_roster(department_id,range_day_id,officer_user_id) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-0000000000a1'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-0000000000a2'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000005b1','0e480000-0000-4000-8000-0000000000b1');
insert into public.remedial_training_recommendations(department_id,officer_user_id,range_day_id,created_by_instructor_user_id,reason) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a1','0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-0000000000a5','grip'),
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a2','0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-0000000000a5','failed qualification'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000000b1','0e480000-0000-4000-8000-0000000005b1','0e480000-0000-4000-8000-0000000000b2','stance');
insert into public.range_packets(department_id,range_day_id,generated_by_user_id) values
 ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000005a1','0e480000-0000-4000-8000-0000000000a5'),
 ('0e480000-0000-4000-8000-00000000000b','0e480000-0000-4000-8000-0000000005b1','0e480000-0000-4000-8000-0000000000b2');
-- Qualification evidence is keyed by the workspace result id; the event file is not evidence.
insert into public.pilot_range_workspaces(department_id,workspace) values
 ('0e480000-0000-4000-8000-00000000000a','{"results":[{"id":"tv-result-1","officerId":"0e480000-0000-4000-8000-0000000000a1"},{"id":"tv-result-2","officerId":"0e480000-0000-4000-8000-0000000000a2"}]}'),
 ('0e480000-0000-4000-8000-00000000000b','{"results":[{"id":"tv-result-1","officerId":"0e480000-0000-4000-8000-0000000000b1"}]}');
insert into public.attachments(department_id,entity_type,entity_key,entity_id,file_name,storage_path,mime_type,file_size,uploaded_by_user_id) values
 ('0e480000-0000-4000-8000-00000000000a','qualification','tv-result-1',null,'t1.jpg','tv/a/1','image/jpeg',1,'0e480000-0000-4000-8000-0000000000a6'),
 ('0e480000-0000-4000-8000-00000000000a','qualification','tv-result-2',null,'t2.jpg','tv/a/2','image/jpeg',1,'0e480000-0000-4000-8000-0000000000a6'),
 ('0e480000-0000-4000-8000-00000000000a','agency_training_event',null,'0e480000-0000-4000-8000-0000000002a1','plan.pdf','tv/a/3','application/pdf',1,'0e480000-0000-4000-8000-0000000000a4'),
 ('0e480000-0000-4000-8000-00000000000b','qualification','tv-result-1',null,'tb.jpg','tv/b/1','image/jpeg',1,'0e480000-0000-4000-8000-0000000000b2');

set local session authorization tracepoint_runtime;
set local role authenticated;

-- Rows of tenant A each subject reads, in their own agency session, per table:
-- certifications, attendees, requirement members, certificates, qualification
-- results, drill results, range roster, remedial, packets, attachments.
do $$
declare subject text; label text; agency text; expected int[]; actual int[];
begin
 for subject, label, agency, expected in values
  ('0e480000-0000-4000-8000-0000000000a1','officer 1','0e480000-0000-4000-8000-00000000000a',array[1,1,1,1,1,1,1,1,0,2]),
  ('0e480000-0000-4000-8000-0000000000a2','officer 2','0e480000-0000-4000-8000-00000000000a',array[1,1,1,1,1,1,1,1,0,2]),
  ('0e480000-0000-4000-8000-0000000000a3','manage_certifications','0e480000-0000-4000-8000-00000000000a',array[3,0,0,0,0,0,0,0,0,1]),
  ('0e480000-0000-4000-8000-0000000000a4','manage_training','0e480000-0000-4000-8000-00000000000a',array[0,2,2,2,2,2,2,2,1,1]),
  ('0e480000-0000-4000-8000-0000000000a5','score_range_days','0e480000-0000-4000-8000-00000000000a',array[0,0,0,0,2,2,2,2,1,3]),
  ('0e480000-0000-4000-8000-0000000000a6','manage_qualifications','0e480000-0000-4000-8000-00000000000a',array[0,0,0,0,2,2,2,2,1,3]),
  ('0e480000-0000-4000-8000-0000000000a7','view_command_dashboard','0e480000-0000-4000-8000-00000000000a',array[3,2,2,0,2,2,2,2,1,1]),
  ('0e480000-0000-4000-8000-0000000000a8','view_analytics','0e480000-0000-4000-8000-00000000000a',array[3,0,0,0,2,2,2,2,1,3]),
  ('0e480000-0000-4000-8000-0000000000a9','administrator','0e480000-0000-4000-8000-00000000000a',array[3,2,2,2,2,2,2,2,1,3]),
  ('0e480000-0000-4000-8000-0000000000aa','inactive officer','0e480000-0000-4000-8000-00000000000a',array[0,0,0,0,0,0,0,0,0,0]),
  ('0e480000-0000-4000-8000-0000000000b1','agency B view_analytics','0e480000-0000-4000-8000-00000000000b',array[0,0,0,0,0,0,0,0,0,0]),
  ('0e480000-0000-4000-8000-0000000000b2','agency B administrator','0e480000-0000-4000-8000-00000000000b',array[0,0,0,0,0,0,0,0,0,0])
 loop
  perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id',agency,true);
  select array[
   (select count(*) from public.training_certifications where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.agency_training_attendees where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.agency_training_requirement_members where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.agency_training_certificates where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.qualification_results where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.drill_run_results where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.range_day_roster where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.remedial_training_recommendations where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.range_packets where department_id='0e480000-0000-4000-8000-00000000000a'),
   (select count(*) from public.attachments where department_id='0e480000-0000-4000-8000-00000000000a')
  ]::int[] into actual;
  if actual is distinct from expected then raise exception 'Training record visibility for % is %, expected %', label, actual, expected; end if;
 end loop;
end $$;

-- An officer's own rows are their own: no other officer's score, note or evidence.
do $$
begin
 perform set_config('tracepoint.subject_id','0e480000-0000-4000-8000-0000000000a1',true), set_config('tracepoint.department_id','0e480000-0000-4000-8000-00000000000a',true);
 if exists(select 1 from public.training_certifications where user_id<>'0e480000-0000-4000-8000-0000000000a1') then raise exception 'Officer read another officer''s certification'; end if;
 if exists(select 1 from public.agency_training_attendees where user_id<>'0e480000-0000-4000-8000-0000000000a1') then raise exception 'Officer read another officer''s training outcome'; end if;
 if exists(select 1 from public.qualification_results where officer_user_id<>'0e480000-0000-4000-8000-0000000000a1') then raise exception 'Officer read another officer''s qualification score'; end if;
 if exists(select 1 from public.drill_run_results where officer_user_id<>'0e480000-0000-4000-8000-0000000000a1') then raise exception 'Officer read another officer''s drill result'; end if;
 if exists(select 1 from public.attachments where entity_key='tv-result-2') then raise exception 'Officer read another officer''s qualification evidence'; end if;
 if not exists(select 1 from public.attachments where entity_key='tv-result-1' and department_id='0e480000-0000-4000-8000-00000000000a') then raise exception 'Officer lost sight of own qualification evidence'; end if;
 -- Agency B's officer with the same result id must not reach A's evidence.
 perform set_config('tracepoint.subject_id','0e480000-0000-4000-8000-0000000000b1',true), set_config('tracepoint.department_id','0e480000-0000-4000-8000-00000000000b',true);
 if exists(select 1 from public.attachments where department_id='0e480000-0000-4000-8000-00000000000a') then raise exception 'Foreign officer read tenant A evidence'; end if;
 if (select count(*) from public.attachments) <> 1 then raise exception 'Foreign officer lost own-tenant evidence'; end if;
end $$;

-- Permitted writers still see what they write (insert ... returning).
do $$
declare inserted uuid;
begin
 perform set_config('tracepoint.subject_id','0e480000-0000-4000-8000-0000000000a3',true), set_config('tracepoint.department_id','0e480000-0000-4000-8000-00000000000a',true);
 insert into public.training_certifications(department_id,user_id,certification_title) values ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a2','Issued by manager') returning id into inserted;
 if inserted is null then raise exception 'Certification manager insert was not returned'; end if;
 perform set_config('tracepoint.subject_id','0e480000-0000-4000-8000-0000000000a5',true);
 insert into public.qualification_results(department_id,officer_user_id,qualification_date,score,passed,record_origin,historical_course_name) values ('0e480000-0000-4000-8000-00000000000a','0e480000-0000-4000-8000-0000000000a2',current_date,90,true,'historical_import','Imported') returning id into inserted;
 if inserted is null then raise exception 'Scorer qualification insert was not returned'; end if;
 perform set_config('tracepoint.subject_id','0e480000-0000-4000-8000-0000000000a4',true);
 update public.agency_training_attendees set score_text='62' where id='0e480000-0000-4000-8000-0000000003a2' returning id into inserted;
 if inserted is null then raise exception 'Training manager roster update was not returned'; end if;
end $$;
reset role;
reset session authorization;
rollback;
