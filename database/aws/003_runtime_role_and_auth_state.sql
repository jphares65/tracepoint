begin;

-- The committed role never contains a credential. The deployment bootstrap
-- rotates the Secrets Manager password and enables LOGIN after all migrations
-- have succeeded.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tracepoint_runtime') then
    create role tracepoint_runtime
      nologin nosuperuser nocreatedb nocreaterole noreplication
      nobypassrls noinherit connection limit 20;
  end if;
end
$$;

alter role tracepoint_runtime
  nologin nosuperuser nocreatedb nocreaterole noreplication
  nobypassrls noinherit connection limit 20;

grant authenticated to tracepoint_runtime;
grant usage on schema public, tracepoint_auth to tracepoint_runtime;

grant select, insert, update, delete on table
  public.authentication_identity_links,
  public.authentication_flow_transactions,
  public.authentication_session_revocations,
  public.authentication_access_sessions,
  public.authentication_refresh_sessions
to tracepoint_runtime;

create policy authentication_identity_links_runtime
  on public.authentication_identity_links for all to tracepoint_runtime
  using (true) with check (true);
create policy authentication_flow_transactions_runtime
  on public.authentication_flow_transactions for all to tracepoint_runtime
  using (true) with check (true);
create policy authentication_session_revocations_runtime
  on public.authentication_session_revocations for all to tracepoint_runtime
  using (true) with check (true);
create policy authentication_access_sessions_runtime
  on public.authentication_access_sessions for all to tracepoint_runtime
  using (true) with check (true);
create policy authentication_refresh_sessions_runtime
  on public.authentication_refresh_sessions for all to tracepoint_runtime
  using (true) with check (true);

revoke create on schema public from tracepoint_runtime;
revoke all on all sequences in schema public from tracepoint_runtime;

commit;
