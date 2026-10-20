begin;

-- Server-only recipient lookups for the scheduled notification jobs (B6).
-- The generation run (TRN-01 / FLT-05) needs the active members of every
-- active agency without a signed-in subject; the dispatcher (TRN-16) must not
-- send already-queued digests to members deactivated after queueing. Both run
-- on the trusted web login only, like enqueue_notification_email (024). Each
-- member's alerts are then generated in that member's own subject-bound
-- session, so RLS still decides what the generator reads and writes.
create or replace function tracepoint_auth.list_notification_generation_targets(
  p_department_id uuid, p_after_department_id uuid, p_after_user_id uuid,
  p_limit integer
) returns table (department_id uuid, user_id uuid)
language plpgsql stable security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
begin
  if session_user <> 'tracepoint_runtime' then
    raise exception 'notification generation listing rejected' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500
    or (p_after_department_id is null) <> (p_after_user_id is null) then
    raise exception 'notification generation listing rejected' using errcode = '22023';
  end if;
  return query
    select m.department_id, m.user_id
    from public.department_memberships m
    join public.departments d on d.id = m.department_id
    where m.is_active = true and d.is_active = true
      and (p_department_id is null or m.department_id = p_department_id)
      and (p_after_department_id is null
        or (m.department_id, m.user_id) > (p_after_department_id, p_after_user_id))
    order by m.department_id, m.user_id
    limit p_limit;
end;
$$;

create or replace function tracepoint_auth.notification_recipient_active(
  p_department_id uuid, p_user_id uuid
) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
begin
  if session_user <> 'tracepoint_runtime' then
    raise exception 'notification recipient check rejected' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.department_memberships m
    join public.departments d on d.id = m.department_id
    where m.department_id = p_department_id and m.user_id = p_user_id
      and m.is_active = true and d.is_active = true
  );
end;
$$;

revoke all on function tracepoint_auth.list_notification_generation_targets(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function tracepoint_auth.notification_recipient_active(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function tracepoint_auth.list_notification_generation_targets(uuid, uuid, uuid, integer)
  to tracepoint_runtime;
grant execute on function tracepoint_auth.notification_recipient_active(uuid, uuid)
  to tracepoint_runtime;

commit;
