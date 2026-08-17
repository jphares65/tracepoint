create or replace function public.record_off_duty_firearm_inspection(
  p_department_id uuid,
  p_request_id uuid,
  p_inspected_by_user_id uuid,
  p_inspection_date date,
  p_result text,
  p_notes text default null
)
returns public.off_duty_firearm_inspections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inspection public.off_duty_firearm_inspections;
begin
  if p_result not in ('Pass', 'Fail') then
    raise exception 'Inspection result must be Pass or Fail.';
  end if;

  if not exists (
    select 1
    from public.off_duty_firearm_requests
    where id = p_request_id
      and department_id = p_department_id
  ) then
    raise exception 'Off-duty firearm request was not found.';
  end if;

  insert into public.off_duty_firearm_inspections (
    department_id,
    request_id,
    inspected_by_user_id,
    inspection_date,
    result,
    notes
  )
  values (
    p_department_id,
    p_request_id,
    p_inspected_by_user_id,
    p_inspection_date,
    p_result,
    p_notes
  )
  returning *
  into v_inspection;

  update public.off_duty_firearm_requests
  set
    inspection_status =
      case
        when p_result = 'Pass' then 'Current'
        else 'Not Inspected'
      end,
    inspection_reviewed = true,
    updated_at = now()
  where id = p_request_id
    and department_id = p_department_id;

  return v_inspection;
end;
$$;

revoke all on function public.record_off_duty_firearm_inspection(
  uuid,
  uuid,
  uuid,
  date,
  text,
  text
) from public;

grant execute on function public.record_off_duty_firearm_inspection(
  uuid,
  uuid,
  uuid,
  date,
  text,
  text
) to service_role;
