begin;

-- NEW-ADM-A: invites, imports and migrations write a 'pending' Cognito link and
-- nothing generic promoted it, so the first sign-in was always rejected.
-- Called only from the session store after the initial Cognito tokens are
-- verified (signature, issuer, client, subject). Returns null, without change,
-- unless the link is still pending and the user holds an active membership.
create or replace function tracepoint_auth.activate_cognito_identity_on_first_login(
  p_issuer text, p_subject text, p_user_id uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_link public.authentication_identity_links%rowtype;
begin
  if session_user <> 'tracepoint_runtime' then
    raise exception 'first-login activation rejected' using errcode = '42501';
  end if;
  -- Membership rows before the link: the order prepare_cognito_membership_operation uses.
  perform 1 from public.department_memberships where user_id = p_user_id for update;
  if not exists(select 1 from public.department_memberships where user_id = p_user_id and is_active) then
    return null;
  end if;
  select * into v_link from public.authentication_identity_links
   where provider = 'cognito' and issuer = p_issuer and subject = p_subject for update;
  if not found or v_link.tracepoint_user_id is distinct from p_user_id or v_link.state <> 'pending' then
    return null;
  end if;
  update public.authentication_identity_links set state = 'active', updated_at = clock_timestamp()
   where provider = 'cognito' and issuer = p_issuer and subject = p_subject
     and tracepoint_user_id = p_user_id and state = 'pending';
  insert into public.authentication_identity_events
    (tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id)
  values (p_user_id,'cognito',p_issuer,p_subject,v_link.provider_username,'activated',p_user_id);
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
   select m.department_id,p_user_id,'account_activated','department_membership',p_user_id,
     'Account activated by first verified Cognito sign-in.',
     jsonb_build_object('activation_status','activated','identity_provider','cognito')
   from public.department_memberships m
   where m.user_id = p_user_id and m.is_active and m.activation_status in ('pending_activation','activation_sent');
  update public.department_memberships set activation_status = 'activated'
   where user_id = p_user_id and is_active and activation_status in ('pending_activation','activation_sent');
  return p_user_id;
end;
$$;
revoke all on function tracepoint_auth.activate_cognito_identity_on_first_login(text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.activate_cognito_identity_on_first_login(text,text,uuid)
  to tracepoint_runtime;

-- NEW-ADM-E prerequisite: 009's prepare_cognito_membership_operation declares
-- OUT column user_id, so every unqualified user_id in its body raised 42702
-- ("column reference is ambiguous") and the import and Settings lifecycle
-- could never run. Same body; the directive resolves names to columns (the
-- body never reads its OUT parameters as variables).
create or replace function tracepoint_auth.prepare_cognito_membership_operation(
  p_operation_id uuid,
  p_operation_kind text,
  p_department_id uuid,
  p_target_user_id uuid
) returns table(user_id uuid,provider_username text,should_change_provider boolean)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict use_column
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
revoke all on function tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid) from public,anon,service_role;
grant execute on function tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid) to authenticated;

-- ADM-03: tenant self-creation is a Supabase setup-page flow only. Under the
-- AWS runtime any membership-less subject could create a department and
-- become its Administrator through this grant.
do $$
begin
  if to_regprocedure('public.create_department_with_owner(text,text,text,text,text,text)') is not null then
    revoke execute on function public.create_department_with_owner(text,text,text,text,text,text)
      from public, anon, authenticated;
  end if;
end;
$$;

commit;
