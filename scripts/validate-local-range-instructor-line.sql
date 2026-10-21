-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers database/aws/051: an
-- instructor (score_range_days) marks attendance, adds present walk-ups to an
-- open-attendance day and attaches target evidence; every other roster and
-- planning change stays range management, and the officer of an imported
-- qualification result reads its evidence.
begin;
insert into auth.users(id,email) values
 ('0e510000-0000-4000-8000-0000000000a1','rl-instructor@example.invalid'),
 ('0e510000-0000-4000-8000-0000000000a2','rl-officer-1@example.invalid'),
 ('0e510000-0000-4000-8000-0000000000a3','rl-officer-2@example.invalid'),
 ('0e510000-0000-4000-8000-0000000000a4','rl-range-master@example.invalid');
insert into public.profiles(id,full_name) select id,email from auth.users where email like 'rl-%' on conflict(id) do nothing;
insert into public.departments(id,name,slug) values ('0e510000-0000-4000-8000-00000000000a','RL tenant A','local-rl-a');
delete from public.department_role_permissions where department_id='0e510000-0000-4000-8000-00000000000a';
insert into public.department_memberships(department_id,user_id,is_active) values
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a1',true),
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a2',true),
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a3',true),
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a4',true);
insert into public.department_membership_roles(department_id,user_id,role_code) values
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a1','instructor'),
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a2','officer'),
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a3','officer'),
 ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a4','range_master');
insert into public.department_role_permissions(department_id,role_code,permission_code) values
 ('0e510000-0000-4000-8000-00000000000a','instructor','score_range_days'),
 ('0e510000-0000-4000-8000-00000000000a','range_master','manage_range_days'),
 ('0e510000-0000-4000-8000-00000000000a','range_master','score_range_days');
insert into public.pilot_range_workspaces(department_id,workspace) values ('0e510000-0000-4000-8000-00000000000a', '{
 "rangeDays":[
  {"id":"rl-scheduled","status":"In Progress","attendanceMode":"Scheduled Roster"},
  {"id":"rl-open","status":"In Progress","attendanceMode":"Open / Rolling Attendance"},
  {"id":"rl-closed","status":"Completed","attendanceMode":"Open / Rolling Attendance"}],
 "drillLibrary":[],"rangeDayDrills":[],
 "rangeRoster":[
  {"id":"rl-r1","rangeDayId":"rl-scheduled","officerId":"0e510000-0000-4000-8000-0000000000a2","assignedFirearmIds":[],"attended":false},
  {"id":"rl-r2","rangeDayId":"rl-closed","officerId":"0e510000-0000-4000-8000-0000000000a2","assignedFirearmIds":[],"attended":true}],
 "results":[],"malfunctions":[]}');
insert into public.qualification_results(id,department_id,officer_user_id,qualification_date,score,passed,record_origin,historical_course_name) values
 ('0e510000-0000-4000-8000-0000000005a1','0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a2',current_date,95,true,'historical_import','Imported');
insert into public.attachments(department_id,entity_type,entity_key,entity_id,file_name,storage_path,mime_type,file_size,uploaded_by_user_id) values
 ('0e510000-0000-4000-8000-00000000000a','qualification','0e510000-0000-4000-8000-0000000005a1',null,'imported.jpg','rl/a/1','image/jpeg',1,'0e510000-0000-4000-8000-0000000000a4');

-- Applies a workspace edit as the subject and rolls it back; returns the error
-- code, 'ok', or 'no rows' when the update policy filtered the row. Each case
-- starts from the seeded document.
create function pg_temp.rl_write(subject text, edit text) returns text language plpgsql as $$
declare touched int;
begin
 perform set_config('tracepoint.subject_id',subject,true), set_config('tracepoint.department_id','0e510000-0000-4000-8000-00000000000a',true);
 begin
  execute format('update public.pilot_range_workspaces set workspace = %s where department_id=%L', edit, '0e510000-0000-4000-8000-00000000000a');
  get diagnostics touched = row_count;
  raise exception using errcode = 'P0099', message = case when touched = 1 then 'ok' else 'no rows' end;
 exception
  when sqlstate 'P0099' then return sqlerrm;
  when others then return sqlstate;
 end;
end $$;
grant execute on function pg_temp.rl_write(text,text) to authenticated;

set local session authorization tracepoint_runtime;
set local role authenticated;

do $$
declare instructor text := '0e510000-0000-4000-8000-0000000000a1'; officer text := '0e510000-0000-4000-8000-0000000000a2';
 master text := '0e510000-0000-4000-8000-0000000000a4'; label text; subject text; edit text; expected text; actual text;
begin
 for label, subject, edit, expected in values
  ('instructor marks attendance', instructor, $e$jsonb_set(workspace,'{rangeRoster,0}', workspace #> '{rangeRoster,0}' || '{"attended":true,"attendanceTime":"2026-10-20T13:00:00Z"}')$e$, 'ok'),
  ('instructor adds a present walk-up to an open day', instructor, $e$jsonb_set(workspace,'{rangeRoster}', (workspace -> 'rangeRoster') || '[{"id":"rl-r3","rangeDayId":"rl-open","officerId":"0e510000-0000-4000-8000-0000000000a3","assignedFirearmIds":[],"attended":true}]')$e$, 'ok'),
  ('instructor adds a walk-up to a scheduled day', instructor, $e$jsonb_set(workspace,'{rangeRoster}', (workspace -> 'rangeRoster') || '[{"id":"rl-r4","rangeDayId":"rl-scheduled","officerId":"0e510000-0000-4000-8000-0000000000a3","assignedFirearmIds":[],"attended":true}]')$e$, '42501'),
  ('instructor adds an absent walk-up', instructor, $e$jsonb_set(workspace,'{rangeRoster}', (workspace -> 'rangeRoster') || '[{"id":"rl-r4","rangeDayId":"rl-open","officerId":"0e510000-0000-4000-8000-0000000000a4","assignedFirearmIds":[],"attended":false}]')$e$, '42501'),
  ('instructor adds the same officer twice', instructor, $e$jsonb_set(workspace,'{rangeRoster}', (workspace -> 'rangeRoster') || '[{"id":"rl-r3","rangeDayId":"rl-open","officerId":"0e510000-0000-4000-8000-0000000000a3","assignedFirearmIds":[],"attended":true},{"id":"rl-r4","rangeDayId":"rl-open","officerId":"0e510000-0000-4000-8000-0000000000a3","assignedFirearmIds":[],"attended":true}]')$e$, '42501'),
  ('instructor removes a roster entry', instructor, $e$jsonb_set(workspace,'{rangeRoster}', (workspace -> 'rangeRoster') - 0)$e$, '42501'),
  ('instructor changes assigned firearms', instructor, $e$jsonb_set(workspace,'{rangeRoster,0,assignedFirearmIds}', '["f-9"]')$e$, '42501'),
  ('instructor changes a range day', instructor, $e$jsonb_set(workspace,'{rangeDays,0,title}', '"Renamed"')$e$, '42501'),
  ('instructor changes attendance on a completed day', instructor, $e$jsonb_set(workspace,'{rangeRoster,1,attended}', 'false')$e$, '23514'),
  ('officer marks attendance', officer, $e$jsonb_set(workspace,'{rangeRoster,0,attended}', 'false')$e$, '42501'),
  ('range master removes a roster entry', master, $e$jsonb_set(workspace,'{rangeRoster}', jsonb_build_array(workspace #> '{rangeRoster,1}'))$e$, 'ok')
 loop
  actual := pg_temp.rl_write(subject, edit);
  -- An officer may be filtered by the update policy instead of the trigger.
  if actual is distinct from expected and not (subject = officer and actual = 'no rows') then
   raise exception 'Range line check "%" returned %, expected %', label, actual, expected;
  end if;
 end loop;
end $$;

-- Evidence: the instructor attaches a target photo and its audit row; the
-- imported result's officer reads its evidence, another officer does not.
do $$
declare inserted uuid;
begin
 perform set_config('tracepoint.subject_id','0e510000-0000-4000-8000-0000000000a1',true), set_config('tracepoint.department_id','0e510000-0000-4000-8000-00000000000a',true);
 insert into public.attachments(department_id,entity_type,entity_key,entity_id,file_name,storage_path,mime_type,file_size,uploaded_by_user_id,attachment_type)
 values ('0e510000-0000-4000-8000-00000000000a','qualification','rl-result-1',null,'t.jpg','rl/a/2','image/jpeg',1,'0e510000-0000-4000-8000-0000000000a1','q_target') returning id into inserted;
 if inserted is null then raise exception 'Instructor target evidence was not stored'; end if;
 insert into public.audit_events(department_id,actor_user_id,action,entity_type,summary)
 values ('0e510000-0000-4000-8000-00000000000a','0e510000-0000-4000-8000-0000000000a1','qualification_evidence_uploaded','qualification','Uploaded target evidence');
 begin
  insert into public.attachments(department_id,entity_type,entity_id,file_name,storage_path,mime_type,file_size,uploaded_by_user_id)
  values ('0e510000-0000-4000-8000-00000000000a','firearm',gen_random_uuid(),'f.jpg','rl/a/3','image/jpeg',1,'0e510000-0000-4000-8000-0000000000a1');
  raise exception 'Instructor stored a non-qualification attachment';
 exception when insufficient_privilege then null;
 end;
 perform set_config('tracepoint.subject_id','0e510000-0000-4000-8000-0000000000a2',true);
 if not exists(select 1 from public.attachments where entity_key='0e510000-0000-4000-8000-0000000005a1') then raise exception 'Officer cannot read evidence on their imported qualification result'; end if;
 perform set_config('tracepoint.subject_id','0e510000-0000-4000-8000-0000000000a3',true);
 if exists(select 1 from public.attachments where entity_key='0e510000-0000-4000-8000-0000000005a1') then raise exception 'Officer read another officer''s imported qualification evidence'; end if;
end $$;
reset role;
reset session authorization;
rollback;
