begin;

-- AT-2 (staging acceptance 2026-10-22): firearm_current_custody kept naming the officer
-- of a returned assignment. Nothing released it on return, and set_firearm_restriction
-- only created custody when no row existed, so a firearm re-issued to another officer
-- under Duty Only showed the previous officer as its holder.
--
-- 1. Returning an assignment releases the custody that belonged to it. An officer
--    holder is removed (the firearm is no longer with that officer, and no storage
--    location is known); a secure-storage holder stays where it is, unlinked from the
--    returned assignment. Each release is audited.
-- 2. Duty Only places a firearm with its current assignee whenever the custody row
--    belongs to any other assignment; custody already recorded under the current
--    assignment (for example a check-in) is kept.
-- 3. Rows already left behind by returned assignments are corrected the same way,
--    with an audit entry each.
-- 4. Custody may only name the active assignment of the same firearm and agency. Every
--    writer (transfer, restricted check-in/out, Duty Only) read the assignment without a
--    lock, so a return committed between that read and the custody write left custody
--    naming the returned assignment again. The guard locks the assignment row: a racing
--    return either waits for the custody write (and then releases it) or has already
--    returned it, and the custody write is refused.

create or replace function public.release_returned_assignment_custody()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_current public.firearm_current_custody%rowtype;
begin
  if new.returned_at is null or old.returned_at is not null then return new; end if;
  select * into v_current from public.firearm_current_custody where firearm_id = new.firearm_id and assignment_id = new.id for update;
  if v_current.firearm_id is null then return new; end if;
  if v_current.holder_type = 'OFFICER' then
    delete from public.firearm_current_custody where firearm_id = new.firearm_id;
  else
    update public.firearm_current_custody set assignment_id = null, updated_by_user_id = coalesce(tracepoint_auth.subject_id(), new.returned_by_user_id), updated_at = now()
    where firearm_id = new.firearm_id;
  end if;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
  values (new.department_id, coalesce(tracepoint_auth.subject_id(), new.returned_by_user_id), 'firearm_custody_released', 'firearm', new.firearm_id,
    'Custody released when the assignment was returned.', to_jsonb(v_current),
    jsonb_build_object('assignment_id', new.id, 'holder_type', case when v_current.holder_type = 'SECURE_STORAGE' then 'SECURE_STORAGE' end,
      'storage_location_id', case when v_current.holder_type = 'SECURE_STORAGE' then v_current.storage_location_id end));
  return new;
end $$;

revoke all on function public.release_returned_assignment_custody() from public, anon, authenticated, service_role, tracepoint_runtime;

drop trigger if exists firearm_assignments_release_custody on public.firearm_assignments;
create trigger firearm_assignments_release_custody
after update of returned_at on public.firearm_assignments
for each row execute function public.release_returned_assignment_custody();

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
  -- A newly restricted, assigned firearm is with its assignee until a check-in under
  -- this assignment proves otherwise. Custody recorded under any other assignment (or
  -- none) predates this issue and is replaced; assignment is never changed here.
  if v_type='duty_only' then
    insert into public.firearm_current_custody(firearm_id, department_id, assignment_id, holder_type, holder_user_id, updated_by_user_id)
    values(p_firearm_id, v_department_id, v_assignment_id, 'OFFICER', v_officer_id, tracepoint_auth.subject_id())
    on conflict (firearm_id) do update set assignment_id=excluded.assignment_id, holder_type='OFFICER', holder_user_id=excluded.holder_user_id,
      storage_location_id=null, custody_since=now(), updated_by_user_id=excluded.updated_by_user_id, updated_at=now()
    where public.firearm_current_custody.assignment_id is distinct from excluded.assignment_id;
  end if;
  insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, new_value)
  values(v_department_id, tracepoint_auth.subject_id(), case when v_had_active then 'firearm_restriction_changed' else 'firearm_restriction_created' end, 'firearm', p_firearm_id,
    coalesce(nullif(btrim(p_reason), ''), case when v_had_active then 'Firearm restriction changed.' else 'Firearm restriction created.' end),
    jsonb_build_object('restriction_id',v_id,'restriction_type',v_type,'assigned_officer_user_id',v_officer_id,'effective_date',p_effective_date,'review_date',p_review_date));
  return v_id;
end $$;

revoke all on function public.set_firearm_restriction(uuid,text,date,text,text,date) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.set_firearm_restriction(uuid,text,date,text,text,date) to authenticated;

-- One-time correction of custody left by assignments returned before this migration.
do $$
declare v_row record;
begin
  for v_row in
    select c.*, a.returned_by_user_id
    from public.firearm_current_custody c
    join public.firearm_assignments a on a.id = c.assignment_id and a.firearm_id = c.firearm_id
    where a.returned_at is not null
    for update of c
  loop
    if v_row.holder_type = 'OFFICER' then
      delete from public.firearm_current_custody where firearm_id = v_row.firearm_id;
    else
      update public.firearm_current_custody set assignment_id = null, updated_at = now() where firearm_id = v_row.firearm_id;
    end if;
    insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
    values (v_row.department_id, v_row.returned_by_user_id, 'firearm_custody_released', 'firearm', v_row.firearm_id,
      'Custody of a returned assignment released by migration 067.',
      jsonb_build_object('assignment_id', v_row.assignment_id, 'holder_type', v_row.holder_type, 'holder_user_id', v_row.holder_user_id, 'storage_location_id', v_row.storage_location_id),
      jsonb_build_object('assignment_id', v_row.assignment_id, 'holder_type', case when v_row.holder_type = 'SECURE_STORAGE' then 'SECURE_STORAGE' end,
        'storage_location_id', case when v_row.holder_type = 'SECURE_STORAGE' then v_row.storage_location_id end, 'migration', '067'));
  end loop;
end $$;

create or replace function public.guard_firearm_custody_assignment()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
begin
  if new.assignment_id is null then return new; end if;
  perform 1 from public.firearm_assignments
  where id = new.assignment_id and firearm_id = new.firearm_id and department_id = new.department_id and returned_at is null
  for share;
  if not found then
    raise exception 'custody must follow the firearm''s active assignment' using errcode = '40001';
  end if;
  return new;
end $$;

revoke all on function public.guard_firearm_custody_assignment() from public, anon, authenticated, service_role, tracepoint_runtime;

drop trigger if exists firearm_current_custody_active_assignment on public.firearm_current_custody;
create trigger firearm_current_custody_active_assignment
before insert or update of assignment_id, firearm_id, department_id on public.firearm_current_custody
for each row execute function public.guard_firearm_custody_assignment();

-- 5. AT-4: a check-in or check-out the firearm is not ready for (for example a second
--    check-in) raised errcode '409', which is not a SQLSTATE, so PostgreSQL replaced the
--    refusal with 42704 "unrecognized exception condition". Unchanged except for 55000.
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
  if (v_action='CHECK_OUT' and v_current.holder_type <> 'SECURE_STORAGE') or (v_action='CHECK_IN' and (v_current.holder_type <> 'OFFICER' or v_current.holder_user_id <> v_assignee)) then raise exception 'firearm is not ready for this custody action' using errcode='55000'; end if;
  if v_action='CHECK_IN' and (p_storage_location_id is null or not exists(select 1 from public.firearm_storage_locations where id=p_storage_location_id and department_id=v_department_id and is_active)) then raise exception 'secure storage location required' using errcode='22023'; end if;
  insert into public.firearm_custody_events(department_id,firearm_id,assignment_id,from_holder_type,from_holder_user_id,from_storage_location_id,to_holder_type,to_holder_user_id,to_storage_location_id,initiating_user_id,action_type,reason,notes,restriction_id,idempotency_key)
  values(v_department_id,p_firearm_id,v_assignment_id,v_current.holder_type,v_current.holder_user_id,v_current.storage_location_id,v_to_type,case when v_action='CHECK_OUT' then v_assignee end,case when v_action='CHECK_IN' then p_storage_location_id end,tracepoint_auth.subject_id(),'TRANSFER',v_action, nullif(btrim(p_notes),''),v_restriction.id,p_idempotency_key) returning id into v_event_id;
  update public.firearm_current_custody set assignment_id=v_assignment_id,holder_type=v_to_type,holder_user_id=case when v_action='CHECK_OUT' then v_assignee end,storage_location_id=case when v_action='CHECK_IN' then p_storage_location_id end,custody_since=now(),updated_by_user_id=tracepoint_auth.subject_id(),updated_at=now() where firearm_id=p_firearm_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,previous_value,new_value,details)
  values(v_department_id,tracepoint_auth.subject_id(),case when v_action='CHECK_OUT' then 'firearm_checked_out' else 'firearm_checked_in' end,'firearm',p_firearm_id,v_action,to_jsonb(v_current),jsonb_build_object('assigned_officer_user_id',v_assignee,'restriction_type',v_restriction.restriction_type,'holder_type',v_to_type,'storage_location_id',case when v_action='CHECK_IN' then p_storage_location_id end),jsonb_build_object('custody_event_id',v_event_id));
  return v_event_id;
end $$;

revoke all on function public.operate_restricted_firearm_custody(uuid,text,uuid,text,uuid) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.operate_restricted_firearm_custody(uuid,text,uuid,text,uuid) to authenticated;

commit;
