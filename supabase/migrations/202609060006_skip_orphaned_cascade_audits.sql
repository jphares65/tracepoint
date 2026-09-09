-- Child DELETE triggers run after the parent department row has been removed
-- during ON DELETE CASCADE. Such audit rows cannot satisfy the immutable
-- tenant foreign key, so retain normal auditing while skipping only orphaned
-- child deletes that are already bounded by the authorized parent deletion.
create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_json jsonb;
  new_json jsonb;
  tenant_text text;
  entity_text text;
  actor_text text;
  tenant_id uuid;
  entity_uuid uuid;
  actor_uuid uuid;
begin
  old_json := case
    when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old)
    else null
  end;
  new_json := case
    when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new)
    else null
  end;
  tenant_text := coalesce(
    nullif(new_json ->> 'department_id', ''),
    nullif(old_json ->> 'department_id', '')
  );
  if tenant_text is null or tenant_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  tenant_id := tenant_text::uuid;

  if tg_op = 'DELETE' and not exists (
    select 1 from public.departments department where department.id = tenant_id
  ) then
    return old;
  end if;

  entity_text := coalesce(
    nullif(new_json ->> 'id', ''),
    nullif(old_json ->> 'id', '')
  );
  if entity_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    entity_uuid := entity_text::uuid;
  else
    entity_uuid := null;
  end if;
  actor_text := coalesce(
    nullif(auth.uid()::text, ''),
    nullif(new_json ->> 'actor_user_id', ''),
    nullif(new_json ->> 'inspected_by_user_id', ''),
    nullif(new_json ->> 'inspector_user_id', ''),
    nullif(new_json ->> 'performed_by_user_id', ''),
    nullif(new_json ->> 'completed_by_user_id', ''),
    nullif(new_json ->> 'updated_by_user_id', ''),
    nullif(new_json ->> 'updated_by', ''),
    nullif(new_json ->> 'assigned_by_user_id', ''),
    nullif(new_json ->> 'assigned_by', ''),
    nullif(new_json ->> 'created_by_user_id', ''),
    nullif(new_json ->> 'created_by', ''),
    nullif(old_json ->> 'actor_user_id', ''),
    nullif(old_json ->> 'inspected_by_user_id', ''),
    nullif(old_json ->> 'inspector_user_id', ''),
    nullif(old_json ->> 'performed_by_user_id', ''),
    nullif(old_json ->> 'completed_by_user_id', ''),
    nullif(old_json ->> 'updated_by_user_id', ''),
    nullif(old_json ->> 'updated_by', ''),
    nullif(old_json ->> 'assigned_by_user_id', ''),
    nullif(old_json ->> 'assigned_by', ''),
    nullif(old_json ->> 'created_by_user_id', ''),
    nullif(old_json ->> 'created_by', '')
  );
  if actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    actor_uuid := actor_text::uuid;
  else
    actor_uuid := null;
  end if;
  insert into public.audit_events (
    department_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    summary,
    previous_value,
    new_value,
    details
  ) values (
    tenant_id,
    actor_uuid,
    lower(tg_op),
    tg_table_name,
    entity_uuid,
    initcap(replace(tg_table_name, '_', ' ')) || ' ' || lower(tg_op),
    old_json,
    new_json,
    jsonb_build_object(
      'source', 'database_trigger',
      'operation', lower(tg_op),
      'table', tg_table_name
    )
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function public.write_audit_event() is
  'Writes immutable tenant-scoped audit events, except child deletes cascading from an authorized department deletion whose tenant row no longer exists.';
