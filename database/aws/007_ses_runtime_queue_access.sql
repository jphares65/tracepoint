begin;

-- The notification dispatcher is a trusted, server-only cross-tenant worker.
-- Its database login is still bounded to the exact email tables it operates.
alter table public.notification_email_queue enable row level security;

grant select, update on table
  public.notification_email_queue
to tracepoint_runtime;

grant select on table
  public.notification_events
to tracepoint_runtime;

grant select, insert, update on table
  public.email_provider_acceptances,
  public.email_provider_events,
  public.email_suppressions
to tracepoint_runtime;

create policy notification_email_queue_runtime
  on public.notification_email_queue for all to tracepoint_runtime
  using (true) with check (true);

create policy notification_events_runtime_dispatch
  on public.notification_events for select to tracepoint_runtime
  using (true);

create policy email_provider_acceptances_runtime
  on public.email_provider_acceptances for all to tracepoint_runtime
  using (true) with check (true);

create policy email_provider_events_runtime
  on public.email_provider_events for all to tracepoint_runtime
  using (true) with check (true);

create policy email_suppressions_runtime
  on public.email_suppressions for all to tracepoint_runtime
  using (true) with check (true);

commit;
