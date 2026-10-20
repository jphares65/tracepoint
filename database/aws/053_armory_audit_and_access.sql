begin;

-- B8a. Firearm status history is written with the status change, and armory
-- staff can see the names of the people the armory shows, without reading
-- profiles or memberships in general.

-- A firearm status change and its history row are one statement. The firearm
-- changes only from the status the caller read; false means it changed
-- underneath. The actor is the signed-in subject. Users can no longer write
-- firearm_status_history directly, so every row is a real change.
create or replace function public.change_firearm_status(
  p_department_id uuid,
  p_firearm_id uuid,
  p_from_status text,
  p_to_status text,
  p_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public,tracepoint_auth
as $$
begin
  if tracepoint_auth.subject_id() is null
     or p_department_id is distinct from tracepoint_auth.department_id()
     or not public.has_any_department_permission(
       p_department_id,
       array['manage_firearms','manage_inspections','administer_department']
     ) then
    raise exception 'firearm status change forbidden' using errcode = '42501';
  end if;
  if p_to_status is null
     or p_to_status not in ('In Service','Out of Service','Maintenance','Inspection Required','Retired')
     or p_to_status is not distinct from p_from_status then
    raise exception 'invalid firearm status change' using errcode = '22023';
  end if;

  update public.firearms
  set condition_status = p_to_status, updated_at = now()
  where id = p_firearm_id
    and department_id = p_department_id
    and condition_status is not distinct from p_from_status;
  if not found then
    return false;
  end if;

  insert into public.firearm_status_history (
    department_id, firearm_id, old_status, new_status, changed_by_user_id, notes
  )
  values (
    p_department_id, p_firearm_id, p_from_status, p_to_status,
    tracepoint_auth.subject_id(), nullif(btrim(p_notes), '')
  );
  return true;
end;
$$;

revoke all on function public.change_firearm_status(uuid,uuid,text,text,text) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.change_firearm_status(uuid,uuid,text,text,text) to authenticated;

drop policy if exists firearm_status_history_insert_managers on public.firearm_status_history;
revoke insert, update, delete on public.firearm_status_history from authenticated;

-- Names for the armory, for the caller's own agency only. A member is
-- returned when the caller may see them in the armory:
-- - any active member, to manage_firearms (the issue picker);
-- - the current holder of a firearm, to whoever sees the firearm list;
-- - a personal rifle's owner or history actor, to rifle reviewers;
-- - whoever acted on the caller's own personal rifle, to its owner.
-- Only the fields the armory shows: no email, phone or other profile data.
create or replace function public.armory_member_identities(
  p_department_id uuid,
  p_user_ids uuid[] default null
)
returns table (
  user_id uuid,
  full_name text,
  rank_title text,
  badge_number text,
  unit_name text,
  is_active boolean
)
language sql
stable
security definer
set search_path = public,tracepoint_auth
as $$
  select membership.user_id, profile.full_name, membership.rank_title,
    membership.badge_number, membership.unit_name, membership.is_active
  from public.department_memberships membership
  left join public.profiles profile on profile.id = membership.user_id
  where membership.department_id = p_department_id
    and p_department_id = tracepoint_auth.department_id()
    and (p_user_ids is null or membership.user_id = any(p_user_ids))
    and (
      (membership.is_active
        and public.has_department_permission(p_department_id, 'manage_firearms'))
      or (exists (
          select 1 from public.firearm_assignments assignment
          where assignment.department_id = p_department_id
            and assignment.assigned_to_user_id = membership.user_id
            and assignment.returned_at is null)
        and public.has_any_department_permission(p_department_id,
          array['manage_firearms','manage_inspections','view_command_dashboard','administer_department']))
      or ((exists (
            select 1 from public.personal_rifles rifle
            where rifle.department_id = p_department_id
              and rifle.owner_user_id = membership.user_id)
          or exists (
            select 1 from public.personal_rifle_status_history history
            where history.department_id = p_department_id
              and history.actor_user_id = membership.user_id))
        and public.has_any_department_permission(p_department_id,
          array['manage_inspections','approve_personal_rifles','administer_department']))
      or exists (
        select 1 from public.personal_rifle_status_history history
        join public.personal_rifles rifle on rifle.id = history.personal_rifle_id
        where history.department_id = p_department_id
          and history.actor_user_id = membership.user_id
          and rifle.owner_user_id = tracepoint_auth.subject_id())
    );
$$;

revoke all on function public.armory_member_identities(uuid,uuid[]) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.armory_member_identities(uuid,uuid[]) to authenticated;

commit;
