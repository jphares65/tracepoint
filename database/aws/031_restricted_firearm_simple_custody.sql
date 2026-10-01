begin;

-- Restricted use is deliberately a small, explicit overlay on an assignment.
-- It does not alter firearm_assignments: daily custody is recorded separately.
insert into public.permissions(code, display_name, description) values
  ('manage_firearm_restrictions', 'Manage Firearm Restrictions', 'Create, change, and remove restricted-use status for assigned firearms.'),
  ('manage_restricted_firearm_custody', 'Manage Restricted Firearm Custody', 'Check restricted firearms in or out for another assigned officer.')
on conflict (code) do update set display_name = excluded.display_name, description = excluded.description;

alter table public.firearm_possession_restrictions
  add column if not exists restriction_type text;

update public.firearm_possession_restrictions
set restriction_type = case when no_possession_permitted then 'no_carry' else 'duty_only' end
where restriction_type is null;

alter table public.firearm_possession_restrictions
  alter column restriction_type set not null,
  drop constraint if exists firearm_possession_restrictions_type_check,
  add constraint firearm_possession_restrictions_type_check check (restriction_type in ('no_carry', 'duty_only'));

create unique index if not exists firearm_possession_restrictions_one_active
  on public.firearm_possession_restrictions (firearm_id)
  where is_active;

-- The assigned officer may see the active restriction needed to operate their
-- own firearm.  Historical/administrative access remains permission-gated.
drop policy if exists firearm_possession_restrictions_read on public.firearm_possession_restrictions;
create policy firearm_possession_restrictions_read on public.firearm_possession_restrictions
for select to authenticated using (
  public.has_department_permission(department_id, 'manage_firearm_restrictions')
  or public.has_department_permission(department_id, 'manage_restricted_firearm_custody')
  or public.has_department_permission(department_id, 'firearm_custody.view_history')
  or public.has_department_permission(department_id, 'manage_firearms')
  or affected_officer_user_id = tracepoint_auth.subject_id()
);

create or replace function public.set_firearm_restriction(
  p_firearm_id uuid, p_restriction_type text, p_effective_date date,
  p_reason text default null, p_notes text default null, p_review_date date default null
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare
  v_department_id uuid := tracepoint_auth.department_id(); v_assignment_id uuid;
  v_officer_id uuid; v_id uuid; v_had_active boolean; v_type text := lower(coalesce(btrim(p_restriction_type), ''));
  v_effective timestamptz := coalesce(p_effective_date::timestamptz, now());
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'manage_firearm_restrictions') then
    raise exception 'restriction-management permission required' using errcode='42501';
  end if;
  if v_type not in ('no_carry', 'duty_only') or not exists (select 1 from public.firearms where id=p_firearm_id and department_id=v_department_id) then
    raise exception 'invalid firearm restriction' using errcode='22023';
  end if;
  select id, assigned_to_user_id into v_assignment_id, v_officer_id from public.firearm_assignments
  where firearm_id=p_firearm_id and department_id=v_department_id and returned_at is null;
  if v_assignment_id is null then raise exception 'restricted use requires an active assignment' using errcode='22023'; end if;
  select exists(select 1 from public.firearm_possession_restrictions where firearm_id=p_firearm_id and department_id=v_department_id and is_active) into v_had_active;
  update public.firearm_possession_restrictions set is_active=false, modified_by_user_id=tracepoint_auth.subject_id(), modified_at=now()
  where firearm_id=p_firearm_id and department_id=v_department_id and is_active;
  insert into public.firearm_possession_restrictions(
    department_id, firearm_id, assignment_id, affected_officer_user_id, effective_start, expires_at,
    reason_category, restriction_type, no_possession_permitted, duty_only, administrative_notes,
    created_by_user_id, modified_by_user_id
  ) values (
    v_department_id, p_firearm_id, v_assignment_id, v_officer_id, v_effective, p_review_date::timestamptz,
    coalesce(nullif(btrim(p_reason), ''), 'Restricted use'), v_type, v_type='no_carry', v_type='duty_only',
    nullif(btrim(p_notes), ''), tracepoint_auth.subject_id(), tracepoint_auth.subject_id()
  ) returning id into v_id;
  -- A newly restricted, assigned firearm is assumed to remain with its assignee
  -- until a check-in proves otherwise; assignment is never changed here.
  if v_type='duty_only' and not exists (select 1 from public.firearm_current_custody where firearm_id=p_firearm_id) then
    insert into public.firearm_current_custody(firearm_id, department_id, assignment_id, holder_type, holder_user_id, updated_by_user_id)
    values(p_firearm_id, v_department_id, v_assignment_id, 'OFFICER', v_officer_id, tracepoint_auth.subject_id());
  end if;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value)
  values(v_department_id, tracepoint_auth.subject_id(), case when v_had_active then 'firearm_restriction_changed' else 'firearm_restriction_created' end, 'firearm', p_firearm_id,
    coalesce(nullif(btrim(p_reason), ''), case when v_had_active then 'Firearm restriction changed.' else 'Firearm restriction created.' end),
    jsonb_build_object('restriction_id',v_id,'restriction_type',v_type,'assigned_officer_user_id',v_officer_id,'effective_date',p_effective_date,'review_date',p_review_date));
  return v_id;
end $$;

create or replace function public.clear_firearm_restriction(p_restriction_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_restriction public.firearm_possession_restrictions%rowtype; v_department_id uuid := tracepoint_auth.department_id();
begin
  if v_department_id is null or not public.has_department_permission(v_department_id, 'manage_firearm_restrictions') then raise exception 'restriction-management permission required' using errcode='42501'; end if;
  select * into v_restriction from public.firearm_possession_restrictions where id=p_restriction_id and department_id=v_department_id and is_active for update;
  if v_restriction.id is null then raise exception 'active restriction unavailable' using errcode='22023'; end if;
  update public.firearm_possession_restrictions set is_active=false, modified_by_user_id=tracepoint_auth.subject_id(), modified_at=now() where id=v_restriction.id;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
  values(v_department_id,tracepoint_auth.subject_id(),'firearm_restriction_removed','firearm',v_restriction.firearm_id,coalesce(nullif(btrim(p_reason),''),'Firearm restriction removed.'),to_jsonb(v_restriction),jsonb_build_object('restriction_id',v_restriction.id,'restriction_type',v_restriction.restriction_type,'assigned_officer_user_id',v_restriction.affected_officer_user_id));
  return v_restriction.id;
end $$;

create or replace function public.operate_restricted_firearm_custody(p_firearm_id uuid, p_action text, p_storage_location_id uuid default null, p_notes text default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare
  v_department_id uuid := tracepoint_auth.department_id(); v_assignment_id uuid; v_assignee uuid;
  v_current public.firearm_current_custody%rowtype; v_restriction public.firearm_possession_restrictions%rowtype;
  v_event_id uuid; v_action text := upper(coalesce(btrim(p_action), '')); v_to_type text;
begin
  if v_department_id is null or p_idempotency_key is null or v_action not in ('CHECK_OUT','CHECK_IN') then raise exception 'invalid restricted custody action' using errcode='22023'; end if;
  select id, assigned_to_user_id into v_assignment_id, v_assignee from public.firearm_assignments where firearm_id=p_firearm_id and department_id=v_department_id and returned_at is null;
  select * into v_restriction from public.firearm_possession_restrictions where firearm_id=p_firearm_id and department_id=v_department_id and is_active and effective_start <= now() and (expires_at is null or expires_at > now()) order by effective_start desc limit 1;
  if v_assignment_id is null or v_restriction.id is null then raise exception 'active assigned firearm restriction required' using errcode='42501'; end if;
  if v_restriction.restriction_type = 'no_carry' and v_action='CHECK_OUT' then raise exception 'no-carry restriction prohibits checkout' using errcode='42501'; end if;
  if v_restriction.restriction_type <> 'duty_only' then raise exception 'restricted custody is unavailable for this restriction' using errcode='42501'; end if;
  if tracepoint_auth.subject_id() <> v_assignee and not public.has_department_permission(v_department_id, 'manage_restricted_firearm_custody') then raise exception 'restricted custody permission required' using errcode='42501'; end if;
  if exists(select 1 from public.firearm_custody_events where department_id=v_department_id and idempotency_key=p_idempotency_key) then select id into v_event_id from public.firearm_custody_events where department_id=v_department_id and idempotency_key=p_idempotency_key; return v_event_id; end if;
  select * into v_current from public.firearm_current_custody where firearm_id=p_firearm_id for update;
  if v_current.firearm_id is null then raise exception 'physical custody must be initialized by an administrator' using errcode='22023'; end if;
  v_to_type := case when v_action='CHECK_OUT' then 'OFFICER' else 'SECURE_STORAGE' end;
  if (v_action='CHECK_OUT' and v_current.holder_type <> 'SECURE_STORAGE') or (v_action='CHECK_IN' and (v_current.holder_type <> 'OFFICER' or v_current.holder_user_id <> v_assignee)) then raise exception 'firearm is not ready for this custody action' using errcode='409'; end if;
  if v_action='CHECK_IN' and (p_storage_location_id is null or not exists(select 1 from public.firearm_storage_locations where id=p_storage_location_id and department_id=v_department_id and is_active)) then raise exception 'secure storage location required' using errcode='22023'; end if;
  insert into public.firearm_custody_events(department_id,firearm_id,assignment_id,from_holder_type,from_holder_user_id,from_storage_location_id,to_holder_type,to_holder_user_id,to_storage_location_id,initiating_user_id,action_type,reason,notes,restriction_id,idempotency_key)
  values(v_department_id,p_firearm_id,v_assignment_id,v_current.holder_type,v_current.holder_user_id,v_current.storage_location_id,v_to_type,case when v_action='CHECK_OUT' then v_assignee end,case when v_action='CHECK_IN' then p_storage_location_id end,tracepoint_auth.subject_id(),'TRANSFER',v_action, nullif(btrim(p_notes),''),v_restriction.id,p_idempotency_key) returning id into v_event_id;
  update public.firearm_current_custody set assignment_id=v_assignment_id,holder_type=v_to_type,holder_user_id=case when v_action='CHECK_OUT' then v_assignee end,storage_location_id=case when v_action='CHECK_IN' then p_storage_location_id end,custody_since=now(),updated_by_user_id=tracepoint_auth.subject_id(),updated_at=now() where firearm_id=p_firearm_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,previous_value,new_value,details)
  values(v_department_id,tracepoint_auth.subject_id(),case when v_action='CHECK_OUT' then 'firearm_checked_out' else 'firearm_checked_in' end,'firearm',p_firearm_id,v_action,to_jsonb(v_current),jsonb_build_object('assigned_officer_user_id',v_assignee,'restriction_type',v_restriction.restriction_type,'holder_type',v_to_type,'storage_location_id',case when v_action='CHECK_IN' then p_storage_location_id end),jsonb_build_object('custody_event_id',v_event_id));
  return v_event_id;
end $$;

revoke all on function public.set_firearm_restriction(uuid,text,date,text,text,date) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.clear_firearm_restriction(uuid,text) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.operate_restricted_firearm_custody(uuid,text,uuid,text,uuid) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.set_firearm_restriction(uuid,text,date,text,text,date) to authenticated;
grant execute on function public.clear_firearm_restriction(uuid,text) to authenticated;
grant execute on function public.operate_restricted_firearm_custody(uuid,text,uuid,text,uuid) to authenticated;

commit;
