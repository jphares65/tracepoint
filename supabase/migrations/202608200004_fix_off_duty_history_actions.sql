alter table public.off_duty_firearm_requests
  add column if not exists qualification_exception_used boolean not null default false,
  add column if not exists qualification_exception_reason text;

drop function if exists public.apply_off_duty_firearm_decision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date
);

create or replace function public.apply_off_duty_firearm_decision(
  p_department_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_action text,
  p_notes text,
  p_effective_date date default null,
  p_expiration_date date default null,
  p_qualification_exception_used boolean default false,
  p_qualification_exception_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_history_action text;
  v_history_notes text;
begin
  if p_action not in ('Approve', 'Deny', 'Return') then
    raise exception 'Invalid off-duty firearm decision action.';
  end if;

  if
    p_action = 'Approve'
    and p_qualification_exception_used
    and nullif(trim(p_qualification_exception_reason), '') is null
  then
    raise exception 'Qualification exception reason is required.';
  end if;

  if p_action = 'Approve' then
    update public.off_duty_firearm_requests
    set
      request_status = 'Approved',
      authorization_status = 'Authorized',
      compliance_status = 'Authorized',
      reviewed_at = now(),
      reviewed_by_user_id = p_actor_user_id,
      approval_effective_date = p_effective_date,
      approval_expiration_date = p_expiration_date,
      decision_notes = p_notes,
      qualification_exception_used = p_qualification_exception_used,
      qualification_exception_reason =
        case
          when p_qualification_exception_used
            then nullif(trim(p_qualification_exception_reason), '')
          else null
        end,
      updated_at = now()
    where id = p_request_id
      and department_id = p_department_id;

  elsif p_action = 'Deny' then
    update public.off_duty_firearm_requests
    set
      request_status = 'Denied',
      authorization_status = 'Not Authorized',
      compliance_status = 'At Risk',
      reviewed_at = now(),
      reviewed_by_user_id = p_actor_user_id,
      approval_effective_date = null,
      approval_expiration_date = null,
      decision_notes = p_notes,
      qualification_exception_used = false,
      qualification_exception_reason = null,
      updated_at = now()
    where id = p_request_id
      and department_id = p_department_id;

  else
    update public.off_duty_firearm_requests
    set
      request_status = 'Returned for Correction',
      authorization_status = 'Not Authorized',
      compliance_status = 'At Risk',
      reviewed_at = now(),
      reviewed_by_user_id = p_actor_user_id,
      approval_effective_date = null,
      approval_expiration_date = null,
      decision_notes = p_notes,
      qualification_exception_used = false,
      qualification_exception_reason = null,
      updated_at = now()
    where id = p_request_id
      and department_id = p_department_id;
  end if;

  if not found then
    raise exception 'Off-duty firearm request was not found.';
  end if;

  v_history_action :=
    case
      when p_action = 'Approve' then 'Approved'
      when p_action = 'Deny' then 'Denied'
      when p_action = 'Return' then 'Returned for Correction'
    end;

  v_history_notes :=
    case
      when p_action = 'Approve'
        and p_qualification_exception_used
      then concat(
        'Approved for off-duty carry. Independent qualification not required per department policy. Justification: ',
        trim(p_qualification_exception_reason),
        case
          when nullif(trim(coalesce(p_notes, '')), '') is not null
            then concat(' Decision notes: ', trim(p_notes))
          else ''
        end
      )
      else coalesce(
        p_notes,
        case
          when p_action = 'Approve'
            then 'Approved for off-duty carry.'
          else null
        end
      )
    end;

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
    v_history_action,
    p_actor_user_id,
    p_actor_name,
    p_actor_role,
    v_history_notes,
    now()
  );
end;
$$;

revoke all on function public.apply_off_duty_firearm_decision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  boolean,
  text
) from public;

grant execute on function public.apply_off_duty_firearm_decision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  boolean,
  text
) to service_role;

notify pgrst, 'reload schema';

