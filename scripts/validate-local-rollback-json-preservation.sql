-- Runs only inside validate-clean-bootstrap's disposable local PostgreSQL,
-- after the database/aws ledger, with the AWS runtime's session shape (see
-- validate-local-field-write-authorization.sql). Covers the rollback
-- compatibility triggers in database/aws/042 and 052: a write in the previous
-- image's shape (range document without resultRevisions; ammunition rows
-- without actor fields) keeps the stored history and actors, its own changes
-- are accounted for, and a write in the current image's shape is stored as sent.
begin;
insert into auth.users(id,email) values
 ('0e7c0000-0000-4000-8000-0000000000a1','rj-range-master@example.invalid'),
 ('0e7c0000-0000-4000-8000-0000000000a2','rj-officer@example.invalid'),
 ('0e7c0000-0000-4000-8000-0000000000a3','rj-armorer-1@example.invalid'),
 ('0e7c0000-0000-4000-8000-0000000000a4','rj-armorer-2@example.invalid');
insert into public.profiles(id,full_name,email) select id,'Name '||split_part(email,'@',1),email from auth.users where email like 'rj-%'
on conflict(id) do update set full_name = excluded.full_name;
insert into public.departments(id,name,slug) values
 ('0e7c0000-0000-4000-8000-00000000000a','RJ tenant A','local-rj-a'),
 ('0e7c0000-0000-4000-8000-00000000000b','RJ tenant B','local-rj-b');
delete from public.department_role_permissions where department_id in ('0e7c0000-0000-4000-8000-00000000000a','0e7c0000-0000-4000-8000-00000000000b');
insert into public.department_memberships(department_id,user_id,is_active)
select d, u, true from unnest(array['0e7c0000-0000-4000-8000-00000000000a','0e7c0000-0000-4000-8000-00000000000b']::uuid[]) d,
 unnest(array['0e7c0000-0000-4000-8000-0000000000a1','0e7c0000-0000-4000-8000-0000000000a2','0e7c0000-0000-4000-8000-0000000000a3','0e7c0000-0000-4000-8000-0000000000a4']::uuid[]) u;
insert into public.department_membership_roles(department_id,user_id,role_code)
select m.department_id, m.user_id, case m.user_id when '0e7c0000-0000-4000-8000-0000000000a1' then 'range_master'
 when '0e7c0000-0000-4000-8000-0000000000a2' then 'officer' else 'armorer' end
from public.department_memberships m where m.department_id in ('0e7c0000-0000-4000-8000-00000000000a','0e7c0000-0000-4000-8000-00000000000b');
insert into public.department_role_permissions(department_id,role_code,permission_code)
select d, r, p from unnest(array['0e7c0000-0000-4000-8000-00000000000a','0e7c0000-0000-4000-8000-00000000000b']::uuid[]) d,
 (values ('range_master','manage_range_days'),('range_master','score_range_days'),('armorer','manage_firearms')) x(r,p);

-- A range document written by the current image: one result, one revision.
insert into public.pilot_range_workspaces(department_id,workspace,updated_at) values ('0e7c0000-0000-4000-8000-00000000000a', '{
 "rangeDays":[{"id":"rj-day","status":"In Progress"}],
 "drillLibrary":[],"rangeDayDrills":[{"id":"rj-drill","rangeDayId":"rj-day"}],"rangeRoster":[],
 "results":[
  {"id":"rj-res-1","rangeDayId":"rj-day","drillId":"rj-drill","runNumber":1,"officerId":"0e7c0000-0000-4000-8000-0000000000a2","score":50,"firearmTypeSnapshot":"Handgun"},
  {"id":"rj-res-2","rangeDayId":"rj-day","drillId":"rj-drill","runNumber":2,"officerId":"0e7c0000-0000-4000-8000-0000000000a2","score":40}],
 "malfunctions":[],
 "resultRevisions":[{"id":"revision-app-0","collection":"results","recordId":"rj-res-1","previous":{"id":"rj-res-1","score":45}}]}',
 '2026-10-20T12:00:00Z');

-- An ammunition document written by the current image.
insert into public.pilot_ammunition_workspaces(department_id,workspace,updated_by) values ('0e7c0000-0000-4000-8000-00000000000a', '{
 "schemaVersion":2,"ammoTypes":[],"lots":[],"settings":{},"dutyLots":[],"trainingLots":[],"transactions":[],
 "activity":[
  {"id":"rj-act-1","kind":"Issue","quantityChange":-5,"recordedByUserId":"0e7c0000-0000-4000-8000-0000000000a3","recordedByName":"Armorer One"},
  {"id":"rj-act-2","kind":"Receive","quantityChange":100,"recordedByUserId":null,"recordedByName":null}],
 "reconciliations":[
  {"id":"rj-count-1","expectedQuantity":100,"physicalQuantity":99,"variance":-1,"notes":"one round short","countedByUserId":"0e7c0000-0000-4000-8000-0000000000a3","countedByName":"Armorer One"}]}',
 '0e7c0000-0000-4000-8000-0000000000a3');

set local session authorization tracepoint_runtime;
set local role authenticated;
select set_config('tracepoint.department_id','0e7c0000-0000-4000-8000-00000000000a',true);

-- Range 1: the previous image corrects res-1 in place (score 51) and sends no history.
select set_config('tracepoint.subject_id','0e7c0000-0000-4000-8000-0000000000a1',true);
update public.pilot_range_workspaces
set workspace = jsonb_set(workspace - 'resultRevisions', '{results,0,score}', '51'),
    updated_by_user_id = '0e7c0000-0000-4000-8000-0000000000a1', updated_at = '2026-10-20T12:01:00Z'
where department_id = '0e7c0000-0000-4000-8000-00000000000a';
reset role;
reset session authorization;
do $$
declare ws jsonb := (select workspace from public.pilot_range_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000a');
begin
 if coalesce(jsonb_array_length(ws->'resultRevisions') <> 2 or ws->'resultRevisions'->0->>'id' <> 'revision-app-0', true) then
  raise exception 'Range: previous-image save lost the stored revision history: %', ws->'resultRevisions';
 end if;
 if coalesce(ws #>> '{results,0,score}' <> '51' or ws #>> '{results,0,firearmTypeSnapshot}' <> 'Handgun'
    or (ws->'resultRevisions'->1) - 'id' <> jsonb_build_object('collection','results','recordId','rj-res-1','rangeDayId','rj-day',
       'replacedById','rj-res-1','revisedAt','2026-10-20T12:01:00.000Z','revisedByUserId','0e7c0000-0000-4000-8000-0000000000a1',
       'recordedBy','database','previous','{"id":"rj-res-1","rangeDayId":"rj-day","drillId":"rj-drill","runNumber":1,"officerId":"0e7c0000-0000-4000-8000-0000000000a2","score":50,"firearmTypeSnapshot":"Handgun"}'::jsonb), true) then
  raise exception 'Range: previous-image correction was not recorded as a database revision: %', ws->'resultRevisions'->1;
 end if;
end $$;
create temporary table rj_sent as
select jsonb_set(jsonb_set(workspace, '{results,0,score}', '52'), '{resultRevisions}', (workspace->'resultRevisions')
 || jsonb_build_array(jsonb_build_object('id','revision-app-1','collection','results','recordId','rj-res-1','previous',workspace #> '{results,0}'))) as ws
from public.pilot_range_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000a';
grant select on rj_sent to authenticated;
set local session authorization tracepoint_runtime;
set local role authenticated;

-- Range 2: the current image corrects res-1 (score 52), appending its own revision of the stored
-- version: stored exactly as sent.
update public.pilot_range_workspaces set workspace = (select ws from rj_sent), updated_at = '2026-10-20T12:02:00Z'
where department_id = '0e7c0000-0000-4000-8000-00000000000a';
reset role;
reset session authorization;
do $$
begin
 if coalesce((select workspace from public.pilot_range_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000a') <> (select ws from rj_sent), true) then
  raise exception 'Range: a current-image write was not stored as sent';
 end if;
end $$;
set local session authorization tracepoint_runtime;
set local role authenticated;

-- Range 3: a write that sends a shortened and a rewritten history and changes no result keeps the stored history.
update public.pilot_range_workspaces
set workspace = jsonb_set(workspace, '{resultRevisions}', '[{"id":"revision-app-0","collection":"results","recordId":"rj-res-1","previous":{"id":"rj-res-1","score":0}}]'),
    updated_at = '2026-10-20T12:03:00Z'
where department_id = '0e7c0000-0000-4000-8000-00000000000a';
reset role;
reset session authorization;
do $$
begin
 if coalesce((select workspace->'resultRevisions' from public.pilot_range_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000a') <> (select ws->'resultRevisions' from rj_sent), true) then
  raise exception 'Range: the revision history was shortened or rewritten';
 end if;
end $$;
set local session authorization tracepoint_runtime;
set local role authenticated;

-- Range 4: a previous-image write that removes res-2: removed, and its last version kept as a revision.
update public.pilot_range_workspaces
set workspace = jsonb_set(workspace - 'resultRevisions', '{results}', jsonb_build_array(workspace #> '{results,0}')),
    updated_at = '2026-10-20T12:04:00Z'
where department_id = '0e7c0000-0000-4000-8000-00000000000a';
-- Range 5: the same previous-image write again changes nothing and adds nothing.
update public.pilot_range_workspaces set workspace = workspace - 'resultRevisions', updated_at = '2026-10-20T12:05:00Z'
where department_id = '0e7c0000-0000-4000-8000-00000000000a';
reset role;
reset session authorization;
do $$
declare ws jsonb := (select workspace from public.pilot_range_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000a');
begin
 if coalesce(jsonb_array_length(ws->'results') <> 1 or jsonb_array_length(ws->'resultRevisions') <> 4
    or ws #>> '{resultRevisions,3,recordId}' <> 'rj-res-2' or ws #>> '{resultRevisions,3,replacedById}' <> ''
    or ws #>> '{resultRevisions,3,previous,score}' <> '40', true) then
  raise exception 'Range: removal was not kept as a removal with its revision: %', ws;
 end if;
end $$;

-- Range 6: a document without history that no write changes gains no key.
insert into public.pilot_range_workspaces(department_id,workspace) values ('0e7c0000-0000-4000-8000-00000000000b', '{"rangeDays":[],"results":[]}');
set local session authorization tracepoint_runtime;
set local role authenticated;
select set_config('tracepoint.department_id','0e7c0000-0000-4000-8000-00000000000b',true);
update public.pilot_range_workspaces set workspace = workspace || '{"malfunctions":[]}' where department_id = '0e7c0000-0000-4000-8000-00000000000b';
reset role;
reset session authorization;
do $$
begin
 if coalesce((select workspace ? 'resultRevisions' from public.pilot_range_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000b'), true) then
  raise exception 'Range: a history key was added to a document that had none';
 end if;
end $$;

-- Ammunition 1: the previous image's page drops every actor field and adds an activity (upsert, as the route writes).
set local session authorization tracepoint_runtime;
set local role authenticated;
select set_config('tracepoint.department_id','0e7c0000-0000-4000-8000-00000000000a',true),
 set_config('tracepoint.subject_id','0e7c0000-0000-4000-8000-0000000000a4',true);
insert into public.pilot_ammunition_workspaces(department_id,workspace,updated_by,updated_at) values ('0e7c0000-0000-4000-8000-00000000000a', '{
 "schemaVersion":2,"ammoTypes":[],"lots":[],"settings":{},"dutyLots":[],"trainingLots":[],"transactions":[],
 "activity":[{"id":"rj-act-1","kind":"Issue","quantityChange":-5},{"id":"rj-act-2","kind":"Receive","quantityChange":100},{"id":"rj-act-3","kind":"Issue","quantityChange":-1}],
 "reconciliations":[{"id":"rj-count-1","expectedQuantity":100,"physicalQuantity":99,"variance":-1,"notes":"one round short"}]}',
 '0e7c0000-0000-4000-8000-0000000000a4', now())
on conflict (department_id) do update set workspace = excluded.workspace, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
reset role;
reset session authorization;
do $$
declare ws jsonb := (select workspace from public.pilot_ammunition_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000a');
begin
 if coalesce(ws->'activity'->0 <> '{"id":"rj-act-1","kind":"Issue","quantityChange":-5,"recordedByUserId":"0e7c0000-0000-4000-8000-0000000000a3","recordedByName":"Armorer One"}'::jsonb
    or ws->'activity'->1 <> '{"id":"rj-act-2","kind":"Receive","quantityChange":100,"recordedByUserId":null,"recordedByName":null}'::jsonb
    or ws->'activity'->2 <> '{"id":"rj-act-3","kind":"Issue","quantityChange":-1,"recordedByUserId":"0e7c0000-0000-4000-8000-0000000000a4","recordedByName":"Name rj-armorer-2"}'::jsonb
    or ws #>> '{reconciliations,0,countedByUserId}' <> '0e7c0000-0000-4000-8000-0000000000a3'
    or ws #>> '{reconciliations,0,countedByName}' <> 'Armorer One', true) then
  raise exception 'Ammunition: previous-image save lost or misattributed actors: %', ws;
 end if;
end $$;

-- Ammunition 2: values a write sends win, and a removed row stays removed.
set local session authorization tracepoint_runtime;
set local role authenticated;
update public.pilot_ammunition_workspaces
set workspace = jsonb_set(jsonb_set(workspace, '{activity}', jsonb_build_array(jsonb_set(workspace #> '{activity,0}', '{recordedByName}', '"Armorer 1"'))), '{reconciliations}', '[]')
where department_id = '0e7c0000-0000-4000-8000-00000000000a';
reset role;
reset session authorization;
do $$
declare ws jsonb := (select workspace from public.pilot_ammunition_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000a');
begin
 if coalesce(jsonb_array_length(ws->'activity') <> 1 or ws #>> '{activity,0,recordedByName}' <> 'Armorer 1'
    or jsonb_array_length(ws->'reconciliations') <> 0, true) then
  raise exception 'Ammunition: a sent value was overridden or a removed row came back: %', ws;
 end if;
end $$;

-- Ammunition 3: the first save of a department by the previous image stamps its rows.
set local session authorization tracepoint_runtime;
set local role authenticated;
select set_config('tracepoint.department_id','0e7c0000-0000-4000-8000-00000000000b',true);
insert into public.pilot_ammunition_workspaces(department_id,workspace,updated_by) values ('0e7c0000-0000-4000-8000-00000000000b',
 '{"schemaVersion":2,"ammoTypes":[],"lots":[],"settings":{},"activity":[{"id":"rj-b-1","kind":"Receive","quantityChange":10}],"reconciliations":[]}',
 '0e7c0000-0000-4000-8000-0000000000a4')
on conflict (department_id) do update set workspace = excluded.workspace;
reset role;
reset session authorization;
do $$
begin
 if coalesce((select workspace #>> '{activity,0,recordedByUserId}' from public.pilot_ammunition_workspaces where department_id='0e7c0000-0000-4000-8000-00000000000b')
    is distinct from '0e7c0000-0000-4000-8000-0000000000a4', true) then
  raise exception 'Ammunition: a first save was not stamped with its actor';
 end if;
end $$;
rollback;
