create schema if not exists tracepoint_auth;

create or replace function tracepoint_auth.subject_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(current_setting('tracepoint.subject_id', true), '')::uuid,
    auth.uid()
  )
$$;

create or replace function tracepoint_auth.department_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(current_setting('tracepoint.department_id', true), '')::uuid
$$;

revoke all on schema tracepoint_auth from public;
grant usage on schema tracepoint_auth to anon, authenticated, service_role;
revoke all on function tracepoint_auth.subject_id() from public;
revoke all on function tracepoint_auth.department_id() from public;
grant execute on function tracepoint_auth.subject_id() to anon, authenticated, service_role;
grant execute on function tracepoint_auth.department_id() to anon, authenticated, service_role;
