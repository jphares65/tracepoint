begin;

-- 070 (AT-5): a Duty Only or No Carry restriction ends with the assignment it was set for.
--
-- set_firearm_restriction (067) ties a restriction to the active assignment and its officer, but returning that
-- assignment left the restriction active: it went on naming the previous officer (who could still read it through
-- 031's policy) and applied to the firearm's next assignee. 067 already releases custody on return; restrictions get
-- the same treatment here, mirroring 067's three parts.
--
-- 1. Returning an assignment ends every active restriction set for it, with an audit entry each.
-- 2. An active restriction may only name the active assignment of the same firearm and agency. set_firearm_restriction
--    reads the assignment without a lock, so a return committed between that read and the insert would leave an
--    active restriction on a returned assignment. The guard locks the assignment row: a racing return either waits for
--    the restriction (and then ends it) or has already returned it, and the restriction is refused.
-- 3. Restrictions already left active on returned assignments are ended the same way, with an audit entry each.
--
-- 4. set_firearm_restriction (067) is unchanged except that it reads the active assignment FOR SHARE. It deactivated
--    the old restriction before the guard locked the assignment, while a return locks the assignment before the return
--    trigger deactivates restrictions; the opposite orders could deadlock a restriction change against a return of the
--    same assignment. Both now take the assignment first.
-- 5. firearm_in_active_department, for the custody route's not-found answer (API-2): the firearms table's own RLS hides
--    firearms from custody-only roles, so the route asks this agency-scoped existence check instead.
--
-- Restrictions without an assignment (028's create_firearm_possession_restriction allowed one) are left alone, and
-- 031/067's other functions keep their definitions; with 2 in place an active restriction's assignment is the active one.

create or replace function public.end_returned_assignment_restrictions()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
declare v_restriction public.firearm_possession_restrictions%rowtype; v_actor uuid := coalesce(tracepoint_auth.subject_id(), new.returned_by_user_id);
begin
  if new.returned_at is null or old.returned_at is not null then return new; end if;
  for v_restriction in
    update public.firearm_possession_restrictions set is_active = false, modified_by_user_id = v_actor, modified_at = now()
    where assignment_id = new.id and firearm_id = new.firearm_id and department_id = new.department_id and is_active
    returning *
  loop
    insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
    values (new.department_id, v_actor, 'firearm_restriction_removed', 'firearm', new.firearm_id,
      'Restriction ended when the assignment was returned.',
      jsonb_build_object('restriction_id', v_restriction.id, 'restriction_type', v_restriction.restriction_type, 'assignment_id', new.id, 'is_active', true),
      jsonb_build_object('restriction_id', v_restriction.id, 'restriction_type', v_restriction.restriction_type,
        'assigned_officer_user_id', v_restriction.affected_officer_user_id, 'assignment_id', new.id, 'is_active', false, 'ended_by', 'assignment_returned'));
  end loop;
  return new;
end $$;

revoke all on function public.end_returned_assignment_restrictions() from public, anon, authenticated, service_role, tracepoint_runtime;

drop trigger if exists firearm_assignments_end_restrictions on public.firearm_assignments;
create trigger firearm_assignments_end_restrictions
after update of returned_at on public.firearm_assignments
for each row execute function public.end_returned_assignment_restrictions();

create or replace function public.guard_firearm_restriction_assignment()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, tracepoint_auth as $$
begin
  if not new.is_active or new.assignment_id is null then return new; end if;
  perform 1 from public.firearm_assignments
  where id = new.assignment_id and firearm_id = new.firearm_id and department_id = new.department_id and returned_at is null
  for share;
  if not found then
    raise exception 'restriction must follow the firearm''s active assignment' using errcode = '40001';
  end if;
  return new;
end $$;

revoke all on function public.guard_firearm_restriction_assignment() from public, anon, authenticated, service_role, tracepoint_runtime;

-- One-time correction of restrictions left active by assignments returned before this migration.
do $$
declare v_row record;
begin
  for v_row in
    select r.*, a.returned_by_user_id
    from public.firearm_possession_restrictions r
    join public.firearm_assignments a on a.id = r.assignment_id and a.firearm_id = r.firearm_id and a.department_id = r.department_id
    where r.is_active and a.returned_at is not null
    for update of r
  loop
    update public.firearm_possession_restrictions set is_active = false, modified_by_user_id = v_row.returned_by_user_id, modified_at = now()
    where id = v_row.id;
    insert into public.audit_events(department_id, actor_user_id, action, entity_type, entity_id, summary, previous_value, new_value)
    values (v_row.department_id, v_row.returned_by_user_id, 'firearm_restriction_removed', 'firearm', v_row.firearm_id,
      'Restriction of a returned assignment ended by migration 070.',
      jsonb_build_object('restriction_id', v_row.id, 'restriction_type', v_row.restriction_type, 'assignment_id', v_row.assignment_id, 'is_active', true),
      jsonb_build_object('restriction_id', v_row.id, 'restriction_type', v_row.restriction_type,
        'assigned_officer_user_id', v_row.affected_officer_user_id, 'assignment_id', v_row.assignment_id, 'is_active', false,
        'ended_by', 'assignment_returned', 'migration', '070'));
  end loop;
end $$;

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
  where firearm_id=p_firearm_id and department_id=v_department_id and returned_at is null
  for share;
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

create or replace function public.firearm_in_active_department(p_firearm_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, tracepoint_auth as $$
  select tracepoint_auth.department_id() is not null
    and public.is_department_member(tracepoint_auth.department_id())
    and exists (select 1 from public.firearms where id = p_firearm_id and department_id = tracepoint_auth.department_id());
$$;

revoke all on function public.firearm_in_active_department(uuid) from public, anon, service_role, tracepoint_runtime;
grant execute on function public.firearm_in_active_department(uuid) to authenticated;

-- After the correction, so it cannot refuse the rows it just ended.
drop trigger if exists firearm_possession_restrictions_active_assignment on public.firearm_possession_restrictions;
create trigger firearm_possession_restrictions_active_assignment
before insert or update of is_active, assignment_id, firearm_id, department_id on public.firearm_possession_restrictions
for each row execute function public.guard_firearm_restriction_assignment();

commit;
