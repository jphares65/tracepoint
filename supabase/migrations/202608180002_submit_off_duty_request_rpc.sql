create or replace function public.submit_off_duty_firearm_request(
  p_department_id uuid,
  p_officer_user_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_make text,
  p_model text,
  p_firearm_type text,
  p_serial_number text,
  p_caliber text,
  p_capacity text default null,
  p_optic text default null,
  p_weapon_light text default null,
  p_holster text default null,
  p_proof_ownership boolean default false,
  p_qualification_reviewed boolean default false,
  p_inspection_reviewed boolean default false,
  p_policy_acknowledged boolean default false,
  p_officer_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if
    nullif(trim(p_make), '') is null
    or nullif(trim(p_model), '') is null
    or nullif(trim(p_firearm_type), '') is null
    or nullif(trim(p_serial_number), '') is null
    or nullif(trim(p_caliber), '') is null
  then
    raise exception
      'Make, model, firearm type, serial number, and caliber are required.';
  end if;

  if p_policy_acknowledged is not true then
    raise exception
      'The off-duty firearm policy acknowledgement is required.';
  end if;

  insert into public.off_duty_firearm_requests (
    department_id,
    officer_user_id,
    make,
    model,
    firearm_type,
    serial_number,
    caliber,
    capacity,
    optic,
    weapon_light,
    holster,
    proof_ownership,
    qualification_reviewed,
    inspection_reviewed,
    policy_acknowledged,
    officer_notes,
    request_status,
    authorization_status,
    inspection_status,
    compliance_status,
    submitted_at,
    created_at,
    updated_at
  )
  values (
    p_department_id,
    p_officer_user_id,
    p_make,
    p_model,
    p_firearm_type,
    p_serial_number,
    p_caliber,
    p_capacity,
    p_optic,
    p_weapon_light,
    p_holster,
    p_proof_ownership,
    p_qualification_reviewed,
    p_inspection_reviewed,
    true,
    p_officer_notes,
    'Pending Command Review',
    'Not Authorized',
    'Not Inspected',
    'At Risk',
    now(),
    now(),
    now()
  )
  returning id into v_request_id;

  insert into public.off_duty_firearm_history (
    department_id,
    request_id,
    action,
    actor_user_id,
    actor_name,
    actor_role,
    notes,
    created_at
  )
  values (
    p_department_id,
    v_request_id,
    'Submitted',
    p_officer_user_id,
    p_actor_name,
    p_actor_role,
    'Submitted for off-duty carry authorization.',
    now()
  );

  return v_request_id;
end;
$$;

revoke all on function public.submit_off_duty_firearm_request(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  boolean,
  boolean,
  text
) from public;

grant execute on function public.submit_off_duty_firearm_request(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  boolean,
  boolean,
  text
) to service_role;
