begin;

alter function public.record_off_duty_firearm_inspection(uuid,uuid,uuid,date,text,text)
  rename to record_off_duty_firearm_inspection_internal;
alter function public.submit_off_duty_firearm_request(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text)
  rename to submit_off_duty_firearm_request_internal;
alter function public.resubmit_off_duty_firearm_request(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text)
  rename to resubmit_off_duty_firearm_request_internal;
alter function public.apply_off_duty_firearm_decision(uuid,uuid,uuid,text,text,text,text,date,date,boolean,text)
  rename to apply_off_duty_firearm_decision_internal;
alter function public.update_firearm_with_audit(uuid,uuid,uuid,text,text,text,text,text,text,text,text)
  rename to update_firearm_with_audit_internal;

revoke all on function public.record_off_duty_firearm_inspection_internal(uuid,uuid,uuid,date,text,text) from public,anon,authenticated,service_role,tracepoint_runtime;
revoke all on function public.submit_off_duty_firearm_request_internal(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text) from public,anon,authenticated,service_role,tracepoint_runtime;
revoke all on function public.resubmit_off_duty_firearm_request_internal(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text) from public,anon,authenticated,service_role,tracepoint_runtime;
revoke all on function public.apply_off_duty_firearm_decision_internal(uuid,uuid,uuid,text,text,text,text,date,date,boolean,text) from public,anon,authenticated,service_role,tracepoint_runtime;
revoke all on function public.update_firearm_with_audit_internal(uuid,uuid,uuid,text,text,text,text,text,text,text,text) from public,anon,authenticated,service_role,tracepoint_runtime;

create function public.record_off_duty_firearm_inspection(
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
set search_path = public,tracepoint_auth
as $$
begin
  if p_department_id is distinct from tracepoint_auth.department_id()
     or p_inspected_by_user_id is distinct from tracepoint_auth.subject_id()
     or not public.has_any_department_permission(
       p_department_id,
       array['manage_inspections','manage_firearms','review_off_duty_requests']
     ) then
    raise exception 'off-duty inspection forbidden' using errcode='42501';
  end if;
  return public.record_off_duty_firearm_inspection_internal(
    p_department_id,p_request_id,p_inspected_by_user_id,p_inspection_date,p_result,p_notes
  );
end;
$$;

create function public.submit_off_duty_firearm_request(
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
set search_path = public,tracepoint_auth
as $$
begin
  if p_department_id is distinct from tracepoint_auth.department_id()
     or p_officer_user_id is distinct from tracepoint_auth.subject_id()
     or not public.has_department_permission(p_department_id,'submit_off_duty_requests') then
    raise exception 'off-duty request submission forbidden' using errcode='42501';
  end if;
  return public.submit_off_duty_firearm_request_internal(
    p_department_id,p_officer_user_id,p_actor_name,p_actor_role,p_make,p_model,
    p_firearm_type,p_serial_number,p_caliber,p_capacity,p_optic,p_weapon_light,
    p_holster,p_proof_ownership,p_qualification_reviewed,p_inspection_reviewed,
    p_policy_acknowledged,p_officer_notes
  );
end;
$$;

create function public.resubmit_off_duty_firearm_request(
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
set search_path = public,tracepoint_auth
as $$
begin
  if p_department_id is distinct from tracepoint_auth.department_id()
     or p_officer_user_id is distinct from tracepoint_auth.subject_id()
     or not public.has_department_permission(p_department_id,'submit_off_duty_requests') then
    raise exception 'off-duty request resubmission forbidden' using errcode='42501';
  end if;
  perform public.resubmit_off_duty_firearm_request_internal(
    p_department_id,p_request_id,p_officer_user_id,p_actor_name,p_actor_role,p_make,
    p_model,p_firearm_type,p_serial_number,p_caliber,p_capacity,p_optic,p_weapon_light,
    p_holster,p_proof_ownership,p_qualification_reviewed,p_inspection_reviewed,
    p_policy_acknowledged,p_officer_notes
  );
end;
$$;

create function public.apply_off_duty_firearm_decision(
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
set search_path = public,tracepoint_auth
as $$
begin
  if p_department_id is distinct from tracepoint_auth.department_id()
     or p_actor_user_id is distinct from tracepoint_auth.subject_id()
     or not public.has_department_permission(p_department_id,'review_off_duty_requests') then
    raise exception 'off-duty request decision forbidden' using errcode='42501';
  end if;
  perform public.apply_off_duty_firearm_decision_internal(
    p_department_id,p_request_id,p_actor_user_id,p_actor_name,p_actor_role,p_action,
    p_notes,p_effective_date,p_expiration_date,p_qualification_exception_used,
    p_qualification_exception_reason
  );
end;
$$;

create function public.update_firearm_with_audit(
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
set search_path = public,tracepoint_auth
as $$
begin
  if p_department_id is distinct from tracepoint_auth.department_id()
     or p_user_id is distinct from tracepoint_auth.subject_id()
     or not public.has_department_permission(p_department_id,'manage_firearms') then
    raise exception 'firearm update forbidden' using errcode='42501';
  end if;
  return public.update_firearm_with_audit_internal(
    p_firearm_id,p_department_id,p_user_id,p_change_note,p_make,p_model,p_serial_number,
    p_firearm_type,p_caliber,p_asset_number,p_notes
  );
end;
$$;

revoke all on function public.record_off_duty_firearm_inspection(uuid,uuid,uuid,date,text,text) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.submit_off_duty_firearm_request(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.resubmit_off_duty_firearm_request(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.apply_off_duty_firearm_decision(uuid,uuid,uuid,text,text,text,text,date,date,boolean,text) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.update_firearm_with_audit(uuid,uuid,uuid,text,text,text,text,text,text,text,text) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.record_off_duty_firearm_inspection(uuid,uuid,uuid,date,text,text) to authenticated;
grant execute on function public.submit_off_duty_firearm_request(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text) to authenticated;
grant execute on function public.resubmit_off_duty_firearm_request(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text) to authenticated;
grant execute on function public.apply_off_duty_firearm_decision(uuid,uuid,uuid,text,text,text,text,date,date,boolean,text) to authenticated;
grant execute on function public.update_firearm_with_audit(uuid,uuid,uuid,text,text,text,text,text,text,text,text) to authenticated;

commit;
