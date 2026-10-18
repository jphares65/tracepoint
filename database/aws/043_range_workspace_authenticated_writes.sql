begin;

-- The AWS-native application runs every tenant request as PostgreSQL role
-- authenticated. The Range Day workspace was carried forward from the
-- Supabase bridge, where only service_role received mutation grants. RLS and
-- its existing tenant/permission policies remain the authorization boundary;
-- this migration restores only the table privileges required for the already
-- authorized INSERT and UPDATE paths.
do $range_workspace_contract$
declare
  workspace_type text;
begin
  if to_regclass('public.pilot_range_workspaces') is null then
    raise exception 'pilot_range_workspaces is required before native Range Day writes can be enabled'
      using errcode = '42P01';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
    into workspace_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.pilot_range_workspaces'::regclass
    and attribute.attname = 'workspace'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if workspace_type is distinct from 'jsonb' then
    raise exception 'pilot_range_workspaces.workspace must be jsonb, found %', coalesce(workspace_type, 'missing')
      using errcode = '42804';
  end if;

  if not exists (
    select 1
    from pg_attribute attribute
    where attribute.attrelid = 'public.pilot_range_workspaces'::regclass
      and attribute.attname = 'updated_by_user_id'
      and attribute.atttypid = 'uuid'::regtype
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception 'pilot_range_workspaces.updated_by_user_id uuid is required'
      using errcode = '42703';
  end if;
end
$range_workspace_contract$;

grant insert, update on public.pilot_range_workspaces to authenticated;

commit;
