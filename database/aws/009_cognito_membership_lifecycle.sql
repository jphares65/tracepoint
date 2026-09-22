begin;

create function tracepoint_auth.prepare_cognito_membership_operation(
  p_operation_id uuid,
  p_operation_kind text,
  p_department_id uuid,
  p_target_user_id uuid
) returns table(user_id uuid,provider_username text,should_change_provider boolean)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=tracepoint_auth.subject_id();
  v_membership public.department_memberships%rowtype;
  v_username text;
  v_other_active integer;
  v_change boolean:=false;
begin
  if session_user<>'tracepoint_runtime' or v_actor is null or p_operation_kind not in ('disable','enable') then
    raise exception 'membership lifecycle rejected' using errcode='22023';
  end if;
  if current_setting('tracepoint.department_id',true) is distinct from p_department_id::text
     or not (public.has_department_permission(p_department_id,'manage_users') or public.has_department_permission(p_department_id,'administer_department')) then
    raise exception 'membership lifecycle forbidden' using errcode='42501';
  end if;
  select * into v_membership from public.department_memberships
   where department_id=p_department_id and user_id=p_target_user_id for update;
  if not found then raise exception 'target membership unavailable' using errcode='P0002'; end if;
  select l.provider_username into v_username from public.authentication_identity_links l
   where l.tracepoint_user_id=p_target_user_id and l.provider='cognito' and l.state in ('pending','active') for update;
  if nullif(v_username,'') is null then raise exception 'cognito identity unavailable' using errcode='P0002'; end if;
  select count(*)::integer into v_other_active from public.department_memberships
   where user_id=p_target_user_id and department_id<>p_department_id and is_active;

  if p_operation_kind='disable' and v_membership.is_active then
    update public.department_memberships set is_active=false,deactivated_at=clock_timestamp()
     where department_id=p_department_id and user_id=p_target_user_id;
    v_change:=v_other_active=0;
    if v_change then
      insert into public.authentication_session_revocations(tracepoint_user_id,issuer,revoked_before)
       select l.tracepoint_user_id,l.issuer,clock_timestamp() from public.authentication_identity_links l
       where l.tracepoint_user_id=p_target_user_id and l.provider='cognito'
       on conflict on constraint authentication_session_revocations_pkey do update
        set revoked_before=greatest(authentication_session_revocations.revoked_before,excluded.revoked_before);
      update public.authentication_access_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where tracepoint_user_id=p_target_user_id;
      update public.authentication_refresh_sessions set state='revoked',sealed_payload=null,updated_at=clock_timestamp()
       where tracepoint_user_id=p_target_user_id and state<>'revoked';
    end if;
  elsif p_operation_kind='enable' and not v_membership.is_active then
    v_change:=v_other_active=0;
  end if;

  insert into public.authentication_lifecycle_operations(id,operation_kind,tracepoint_user_id,department_id,actor_user_id,provider_username,state)
   values(p_operation_id,p_operation_kind,p_target_user_id,p_department_id,v_actor,v_username,'prepared');
  return query select p_target_user_id,v_username,v_change;
end;
$$;

create function tracepoint_auth.finish_cognito_membership_operation(
  p_operation_id uuid,
  p_succeeded boolean,
  p_error_code text default null
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
  if session_user<>'tracepoint_runtime' then raise exception 'membership lifecycle finish rejected' using errcode='42501'; end if;
  select * into v_op from public.authentication_lifecycle_operations
   where id=p_operation_id and operation_kind in ('disable','enable') and state='prepared' for update;
  if not found then raise exception 'membership lifecycle operation unavailable' using errcode='P0002'; end if;
  if not p_succeeded then
    update public.authentication_lifecycle_operations set state='compensation_required',attempts=attempts+1,
     safe_error_code=left(coalesce(p_error_code,'provider_unavailable'),80),updated_at=now() where id=p_operation_id;
    return;
  end if;
  if v_op.operation_kind='enable' then
    update public.department_memberships set is_active=true,deactivated_at=null
     where department_id=v_op.department_id and user_id=v_op.tracepoint_user_id;
  end if;
  insert into public.authentication_identity_events(tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id,operation_id)
   select v_op.tracepoint_user_id,'cognito',l.issuer,l.subject,l.provider_username,
    case when v_op.operation_kind='disable' then 'disabled' else 'enabled' end,v_op.actor_user_id,v_op.id
   from public.authentication_identity_links l where l.tracepoint_user_id=v_op.tracepoint_user_id and l.provider='cognito';
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
   values(v_op.department_id,v_op.actor_user_id,
    case when v_op.operation_kind='disable' then 'department_membership_deactivated' else 'department_membership_reactivated' end,
    'department_membership',v_op.tracepoint_user_id,
    case when v_op.operation_kind='disable' then 'A department membership was deactivated.' else 'A department membership was reactivated.' end,
    jsonb_build_object('target_user_id',v_op.tracepoint_user_id,'identity_provider','cognito'));
  update public.authentication_lifecycle_operations set state='committed',attempts=attempts+1,safe_error_code=null,updated_at=now() where id=p_operation_id;
end;
$$;

revoke all on function tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid) from public,anon,service_role;
grant execute on function tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid) to authenticated;
revoke all on function tracepoint_auth.finish_cognito_membership_operation(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.finish_cognito_membership_operation(uuid,boolean,text) to tracepoint_runtime;

commit;
