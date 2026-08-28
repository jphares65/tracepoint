begin;

create or replace function public.write_agency_training_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_json jsonb;
  new_json jsonb;
  source_json jsonb;
  tenant_id uuid;
  entity_uuid uuid;
  actor_uuid uuid;
  actor_text text;
  resource_label text;
  resource_action text;
begin
  old_json := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_json := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  source_json := coalesce(new_json, old_json);
  tenant_id := nullif(source_json ->> 'department_id', '')::uuid;
  entity_uuid := nullif(source_json ->> 'id', '')::uuid;

  actor_text := coalesce(
    nullif(auth.uid()::text, ''),
    nullif(new_json ->> 'updated_by_user_id', ''),
    nullif(new_json ->> 'recorded_by_user_id', ''),
    nullif(new_json ->> 'closed_by_user_id', ''),
    nullif(new_json ->> 'issued_by_user_id', ''),
    nullif(new_json ->> 'revoked_by_user_id', ''),
    nullif(new_json ->> 'created_by_user_id', ''),
    nullif(old_json ->> 'updated_by_user_id', ''),
    nullif(old_json ->> 'recorded_by_user_id', ''),
    nullif(old_json ->> 'closed_by_user_id', ''),
    nullif(old_json ->> 'issued_by_user_id', ''),
    nullif(old_json ->> 'revoked_by_user_id', ''),
    nullif(old_json ->> 'created_by_user_id', '')
  );
  actor_uuid := case
    when actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then actor_text::uuid
    else null
  end;

  resource_label := case tg_table_name
    when 'agency_training_events' then 'Agency training event'
    when 'agency_training_event_instructors' then 'Agency training instructor'
    when 'agency_training_attendees' then 'Agency training attendee'
    when 'agency_training_certificates' then 'Agency training certificate'
    when 'agency_training_courses' then 'Agency training course'
    when 'agency_training_course_aliases' then 'Agency training course alias'
    when 'agency_training_requirements' then 'Agency training requirement'
    when 'agency_training_requirement_members' then 'Agency training requirement assignment'
    else initcap(replace(tg_table_name, '_', ' '))
  end;

  resource_action := case tg_op
    when 'INSERT' then 'created'
    when 'UPDATE' then 'updated'
    when 'DELETE' then 'deleted'
  end;

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
    replace(tg_table_name, 'agency_training_', 'agency_training_') || '_' || resource_action,
    tg_table_name,
    entity_uuid,
    resource_label || ' ' || resource_action,
    old_json,
    new_json,
    jsonb_build_object(
      'source', 'agency_training_database_trigger',
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
    'agency_training_events',
    'agency_training_event_instructors',
    'agency_training_attendees',
    'agency_training_certificates',
    'agency_training_courses',
    'agency_training_course_aliases',
    'agency_training_requirements',
    'agency_training_requirement_members'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      trigger_name := table_name || '_accountability_audit';
      execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.write_agency_training_audit_event()',
        trigger_name,
        table_name
      );
    end if;
  end loop;
end;
$$;

-- Historical audit events remain immutable by design. -- The specialized trigger below applies readable actions to future events.

comment on function public.write_agency_training_audit_event() is
  'Writes readable, tenant-scoped, attributed Agency Training audit events.';

commit;