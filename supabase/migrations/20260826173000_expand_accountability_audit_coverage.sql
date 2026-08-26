begin;

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
  )
  values (
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

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array[
    'ammunition_lots',
    'ammunition_transactions',
    'ammunition_reconciliations',
    'ammunition_reconciliation_items',
    'firearm_status_history',
    'personal_rifles',
    'personal_rifle_status_history',
    'equipment_assets',
    'department_equipment_requirements',
    'equipment_types',
    'off_duty_firearm_inspections',
    'off_duty_firearm_history',
    'pilot_range_workspaces',
    'department_qualification_standards',
    'department_qualification_standard_components',
    'platform_agency_accounts',
    'department_feature_events',
    'department_features',
    'certification_types',
    'department_certification_capabilities',
    'department_certification_requirements',
    'training_certifications'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      trigger_name := table_name || '_accountability_audit';

      execute format(
        'drop trigger if exists %I on public.%I',
        trigger_name,
        table_name
      );

      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_event()',
        trigger_name,
        table_name
      );
    end if;
  end loop;
end;
$$;

comment on function public.write_audit_event() is
  'Writes immutable tenant-scoped audit events and derives the actor from the authenticated session or server-stamped record attribution fields.';

commit;
