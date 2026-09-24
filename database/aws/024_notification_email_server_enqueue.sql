begin;

-- Only the trusted web login may enqueue; subject-bound sessions cannot.
create function tracepoint_auth.enqueue_notification_email(
  p_department_id uuid, p_user_id uuid, p_recipient_email text,
  p_notification_key text, p_fingerprint text, p_subject text,
  p_body_text text, p_scheduled_for timestamptz, p_status text,
  p_updated_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, tracepoint_auth
as $$
begin
  if session_user <> 'tracepoint_runtime' then
    raise exception 'notification enqueue rejected' using errcode = '42501';
  end if;
  if p_department_id is null or p_user_id is null
    or nullif(btrim(p_recipient_email), '') is null
    or nullif(btrim(p_notification_key), '') is null
    or nullif(btrim(p_fingerprint), '') is null
    or nullif(btrim(p_subject), '') is null
    or nullif(btrim(p_body_text), '') is null
    or p_scheduled_for is null or p_updated_at is null
    or p_status is distinct from 'Pending'
    or not exists (
      select 1 from public.department_memberships m
      join public.profiles p on p.id = m.user_id
      where m.department_id = p_department_id and m.user_id = p_user_id
        and m.is_active = true
        and lower(btrim(p.email)) = lower(btrim(p_recipient_email))
    )
    or not exists (
      select 1 from public.notification_events e
      where e.department_id = p_department_id and e.user_id = p_user_id
        and e.notification_key = p_notification_key
        and e.fingerprint = p_fingerprint
    ) then
    raise exception 'notification enqueue rejected' using errcode = '42501';
  end if;

  insert into public.notification_email_queue (
    department_id, user_id, recipient_email, notification_key, fingerprint,
    subject, body_text, scheduled_for, status, updated_at
  ) values (
    p_department_id, p_user_id, p_recipient_email, p_notification_key,
    p_fingerprint, p_subject, p_body_text, p_scheduled_for, p_status,
    p_updated_at
  ) on conflict (department_id, user_id, notification_key, fingerprint) do nothing;
  return true;
end;
$$;

revoke all on function tracepoint_auth.enqueue_notification_email(
  uuid, uuid, text, text, text, text, text, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function tracepoint_auth.enqueue_notification_email(
  uuid, uuid, text, text, text, text, text, timestamptz, text, timestamptz
) to tracepoint_runtime;

commit;
