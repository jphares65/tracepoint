create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  changed_by_user_id uuid not null references auth.users(id),
  change_note text not null,
  changed_fields text[] not null default '{}',
  old_values jsonb not null,
  new_values jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_department_created_idx
  on public.audit_log (department_id, created_at desc);

create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit log records are immutable.';
end;
$$;

drop trigger if exists prevent_audit_log_update on public.audit_log;
create trigger prevent_audit_log_update
before update on public.audit_log
for each row
execute function public.prevent_audit_log_mutation();

drop trigger if exists prevent_audit_log_delete on public.audit_log;
create trigger prevent_audit_log_delete
before delete on public.audit_log
for each row
execute function public.prevent_audit_log_mutation();

create or replace function public.update_firearm_with_audit(
  p_firearm_id uuid,
  p_department_id uuid,
  p_user_id uuid,
  p_change_note text,
  p_make text,
  p_model text,
  p_serial_number text,
  p_firearm_type text,
  p_caliber text,
  p_asset_number text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.firearms%rowtype;
  v_new public.firearms%rowtype;
  v_changed_fields text[];
begin
  if nullif(trim(p_change_note), '') is null then
    raise exception 'A change note is required.';
  end if;

  if nullif(trim(p_make), '') is null
     or nullif(trim(p_model), '') is null
     or nullif(trim(p_serial_number), '') is null then
    raise exception 'Make, model, and serial number are required.';
  end if;

  select *
  into v_old
  from public.firearms
  where id = p_firearm_id
    and department_id = p_department_id
  for update;

  if not found then
    raise exception 'Firearm not found for this department.';
  end if;

  v_changed_fields := array_remove(array[
    case when v_old.make is distinct from trim(p_make) then 'make' end,
    case when v_old.model is distinct from trim(p_model) then 'model' end,
    case when v_old.serial_number is distinct from trim(p_serial_number) then 'serial_number' end,
    case when v_old.firearm_type::text is distinct from p_firearm_type then 'firearm_type' end,
    case when v_old.caliber is distinct from nullif(trim(p_caliber), '') then 'caliber' end,
    case when v_old.asset_number is distinct from nullif(trim(p_asset_number), '') then 'asset_number' end,
    case when v_old.notes is distinct from nullif(trim(p_notes), '') then 'notes' end
  ], null);

  if coalesce(array_length(v_changed_fields, 1), 0) = 0 then
    raise exception 'No firearm details were changed.';
  end if;

  update public.firearms
  set
    make = trim(p_make),
    model = trim(p_model),
    serial_number = trim(p_serial_number),
    firearm_type = p_firearm_type::public.firearm_type,
    caliber = nullif(trim(p_caliber), ''),
    asset_number = nullif(trim(p_asset_number), ''),
    notes = nullif(trim(p_notes), ''),
    updated_at = now()
  where id = p_firearm_id
    and department_id = p_department_id
  returning * into v_new;

  insert into public.audit_log (
    department_id,
    entity_type,
    entity_id,
    action,
    changed_by_user_id,
    change_note,
    changed_fields,
    old_values,
    new_values
  )
  values (
    p_department_id,
    'firearm',
    p_firearm_id,
    'firearm_updated',
    p_user_id,
    trim(p_change_note),
    v_changed_fields,
    jsonb_build_object(
      'make', v_old.make,
      'model', v_old.model,
      'serial_number', v_old.serial_number,
      'firearm_type', v_old.firearm_type,
      'caliber', v_old.caliber,
      'asset_number', v_old.asset_number,
      'notes', v_old.notes
    ),
    jsonb_build_object(
      'make', v_new.make,
      'model', v_new.model,
      'serial_number', v_new.serial_number,
      'firearm_type', v_new.firearm_type,
      'caliber', v_new.caliber,
      'asset_number', v_new.asset_number,
      'notes', v_new.notes
    )
  );

  return jsonb_build_object(
    'ok', true,
    'firearm_id', p_firearm_id,
    'changed_fields', v_changed_fields
  );
end;
$$;
