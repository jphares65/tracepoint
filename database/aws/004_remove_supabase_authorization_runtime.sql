begin;

create or replace function tracepoint_auth.subject_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(current_setting('tracepoint.subject_id', true), '')::uuid
$$;

-- Historical migrations are immutable. Rebuild the resulting target objects
-- once so the final AWS schema uses TracePoint transaction context directly.
do $provider_exit$
declare
  item record;
  definition text;
begin
  for item in
    select p.oid, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and pg_get_functiondef(p.oid) like '%auth.uid()%'
  loop
    definition := replace(item.definition, 'auth.uid()', 'tracepoint_auth.subject_id()');
    execute definition;
  end loop;

  for item in
    select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%')
  loop
    execute format('drop policy %I on %I.%I', item.policyname, item.schemaname, item.tablename);
    definition := format(
      'create policy %I on %I.%I as %s for %s to %s%s%s',
      item.policyname,
      item.schemaname,
      item.tablename,
      item.permissive,
      item.cmd,
      (select string_agg(quote_ident(role_name), ', ') from unnest(item.roles) role_name),
      case when item.qual is null then '' else format(' using (%s)', replace(item.qual, 'auth.uid()', 'tracepoint_auth.subject_id()')) end,
      case when item.with_check is null then '' else format(' with check (%s)', replace(item.with_check, 'auth.uid()', 'tracepoint_auth.subject_id()')) end
    );
    execute definition;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'tracepoint_auth')
      and p.prokind in ('f', 'p')
      and pg_get_functiondef(p.oid) like '%auth.uid()%'
  ) or exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%')
  ) then
    raise exception 'Supabase authorization dependency remains in the AWS target schema';
  end if;
end
$provider_exit$;

revoke all privileges on all tables in schema public from anon, service_role;
revoke all privileges on all sequences in schema public from anon, service_role;
revoke all privileges on all functions in schema public from anon, service_role;
revoke usage on schema public, tracepoint_auth from anon, service_role;

commit;
