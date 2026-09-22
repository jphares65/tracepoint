begin;

alter function public.close_agency_training_event(uuid,uuid,uuid)
  rename to close_agency_training_event_internal;
alter function public.reopen_agency_training_event(uuid,uuid,uuid,text)
  rename to reopen_agency_training_event_internal;

revoke all on function public.close_agency_training_event_internal(uuid,uuid,uuid) from public,anon,authenticated,service_role,tracepoint_runtime;
revoke all on function public.reopen_agency_training_event_internal(uuid,uuid,uuid,text) from public,anon,authenticated,service_role,tracepoint_runtime;

create function public.close_agency_training_event(
  p_department_id uuid,
  p_event_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public,tracepoint_auth
as $$
begin
  if p_department_id is distinct from tracepoint_auth.department_id()
     or p_actor_user_id is distinct from tracepoint_auth.subject_id()
     or not public.has_department_permission(p_department_id,'manage_training') then
    raise exception 'training closeout forbidden' using errcode='42501';
  end if;
  return public.close_agency_training_event_internal(p_department_id,p_event_id,p_actor_user_id);
end;
$$;

create function public.reopen_agency_training_event(
  p_department_id uuid,
  p_event_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public,tracepoint_auth
as $$
begin
  if p_department_id is distinct from tracepoint_auth.department_id()
     or p_actor_user_id is distinct from tracepoint_auth.subject_id()
     or not public.has_department_permission(p_department_id,'manage_training') then
    raise exception 'training reopen forbidden' using errcode='42501';
  end if;
  perform public.reopen_agency_training_event_internal(p_department_id,p_event_id,p_actor_user_id,p_reason);
end;
$$;

revoke all on function public.close_agency_training_event(uuid,uuid,uuid) from public,anon,service_role,tracepoint_runtime;
revoke all on function public.reopen_agency_training_event(uuid,uuid,uuid,text) from public,anon,service_role,tracepoint_runtime;
grant execute on function public.close_agency_training_event(uuid,uuid,uuid) to authenticated;
grant execute on function public.reopen_agency_training_event(uuid,uuid,uuid,text) to authenticated;

commit;
