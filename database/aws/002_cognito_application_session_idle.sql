alter table public.authentication_refresh_sessions
  add column last_seen_at timestamptz,
  add column idle_expires_at timestamptz;

update public.authentication_refresh_sessions
set last_seen_at = greatest(
      authenticated_at,
      least(updated_at, expires_at - interval '1 microsecond')
    ),
    idle_expires_at = least(
      expires_at,
      greatest(authenticated_at, least(updated_at, expires_at - interval '1 microsecond'))
        + interval '30 minutes'
    );

alter table public.authentication_refresh_sessions
  alter column last_seen_at set not null,
  alter column idle_expires_at set not null,
  add constraint authentication_refresh_idle_window
    check (
      last_seen_at >= authenticated_at
      and idle_expires_at > last_seen_at
      and idle_expires_at <= expires_at
      and idle_expires_at <= last_seen_at + interval '30 minutes'
    );

create index authentication_refresh_ready_session
  on public.authentication_refresh_sessions(handle_hash, idle_expires_at)
  where state = 'ready';
