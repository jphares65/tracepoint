create or replace function public.resubmit_off_duty_firearm_request(
  p_department_id uuid,
  p_request_id uuid,
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
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  update public.off_duty_firearm_requests
  set
    make = p_make,
    model = p_model,
    firearm_type = p_firearm_type,
    serial_number = p_serial_number,
    caliber = p_caliber,
    capacity = p_capacity,
    optic = p_optic,
    weapon_light = p_weapon_light,
    holster = p_holster,
    proof_ownership = p_proof_ownership,
    qualification_reviewed = p_qualification_reviewed,
    inspection_reviewed = p_inspection_reviewed,
    policy_acknowledged = true,
    officer_notes = p_officer_notes,
    request_status = 'Pending Command Review',
    authorization_status = 'Not Authorized',
    compliance_status = 'At Risk',
    submitted_at = now(),
    reviewed_at = null,
    reviewed_by_user_id = null,
    approval_effective_date = null,
    approval_expiration_date = null,
    decision_notes = null,
    updated_at = now()
  where id = p_request_id
    and department_id = p_department_id
    and officer_user_id = p_officer_user_id
    and request_status = 'Returned for Correction';

  if not found then
    raise exception
      'Only a returned request may be resubmitted by its submitting officer.';
  end if;

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
    p_request_id,
    'Resubmitted',
    p_officer_user_id,
    p_actor_name,
    p_actor_role,
    'Corrected request resubmitted for command review.',
    now()
  );
end;
$$;

revoke all on function public.resubmit_off_duty_firearm_request(
  uuid,
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

grant execute on function public.resubmit_off_duty_firearm_request(
  uuid,
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
