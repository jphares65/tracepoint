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
-- Restrictions without an assignment (028's create_firearm_possession_restriction allowed one) are left alone, and
-- 031/067's functions keep their definitions; with 2 in place an active restriction's assignment is the active one.

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

-- After the correction, so it cannot refuse the rows it just ended.
drop trigger if exists firearm_possession_restrictions_active_assignment on public.firearm_possession_restrictions;
create trigger firearm_possession_restrictions_active_assignment
before insert or update of is_active, assignment_id, firearm_id, department_id on public.firearm_possession_restrictions
for each row execute function public.guard_firearm_restriction_assignment();

commit;
