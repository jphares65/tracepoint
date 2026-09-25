-- Phase 3C disposable rehearsal only. Never include in the production schema lineage.
-- The exact pins prevent this function from activating any other pending identity.
begin;

create or replace function tracepoint_auth.promote_rehearsal_readington_officer_first_login(
  p_issuer text, p_subject text, p_user_id uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_department constant uuid := 'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0';
  v_user constant uuid := 'b3848045-a73a-4f81-8a0e-cbd92abcd1be';
  v_operation constant uuid := 'd6965d2e-1c0c-4c1f-9e47-57dc08a5e02c';
  v_subject constant text := '445834f8-2071-7015-690e-20674d04f5c3';
  v_issuer constant text := 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wZwXHpznS';
  v_email constant text := 'jphares@tracepointhq.com';
  v_link public.authentication_identity_links%rowtype;
  v_membership public.department_memberships%rowtype;
  v_operation_row public.authentication_lifecycle_operations%rowtype;
  v_rows integer;
begin
  if session_user <> 'tracepoint_runtime' or p_issuer is distinct from v_issuer
     or p_subject is distinct from v_subject or p_user_id is distinct from v_user then
    raise exception 'rehearsal first-login target rejected' using errcode = '42501';
  end if;

  select * into v_link from public.authentication_identity_links
   where provider = 'cognito' and issuer = v_issuer and subject = v_subject for update;
  if not found or v_link.tracepoint_user_id <> v_user or v_link.state <> 'pending'
     or v_link.provider_username <> v_subject
     or (select count(*) from public.authentication_identity_links where tracepoint_user_id = v_user) <> 1
     or (select count(*) from public.authentication_identity_links where provider = 'cognito' and issuer = v_issuer and subject = v_subject) <> 1 then
    raise exception 'rehearsal first-login link conflict' using errcode = '42501';
  end if;

  select * into v_membership from public.department_memberships
   where department_id = v_department and user_id = v_user for update;
  if not found or not v_membership.is_active or v_membership.deactivated_at is not null
     or v_membership.activation_status <> 'activation_sent'
     or (select count(*) from public.department_memberships where user_id = v_user) <> 1
     or (select count(*) from public.department_membership_roles where user_id = v_user) <> 1
     or (select count(*) from public.department_membership_roles
          where department_id = v_department and user_id = v_user and role_code = 'officer') <> 1 then
    raise exception 'rehearsal first-login membership conflict' using errcode = '42501';
  end if;

  select * into v_operation_row from public.authentication_lifecycle_operations
   where id = v_operation and tracepoint_user_id = v_user for update;
  if not found or v_operation_row.department_id <> v_department
     or v_operation_row.operation_kind <> 'invite' or v_operation_row.state <> 'committed'
     or v_operation_row.provider_subject <> v_subject or v_operation_row.provider_username <> v_subject
     or v_operation_row.safe_error_code is not null
     or (select count(*) from public.authentication_lifecycle_operations where tracepoint_user_id = v_user) <> 1
     or (select count(*) from public.authentication_identity_events
          where tracepoint_user_id = v_user and operation_id = v_operation
            and event_type = 'linked' and subject = v_subject) <> 1
     or exists(select 1 from public.authentication_identity_events
          where tracepoint_user_id = v_user and event_type = 'activated') then
    raise exception 'rehearsal first-login lifecycle conflict' using errcode = '42501';
  end if;

  if (select count(*) from public.profiles where id = v_user and lower(btrim(email)) = v_email) <> 1
     or exists(select 1 from public.profiles where id <> v_user and lower(btrim(email)) = v_email)
     or (select count(*) from auth.users where id = v_user and lower(btrim(email)) = v_email) <> 1
     or exists(select 1 from auth.users where id <> v_user and lower(btrim(email)) = v_email)
     or exists(select 1 from public.user_activation_tokens where user_id = v_user and used_at is null and revoked_at is null) then
    raise exception 'rehearsal first-login application identity conflict' using errcode = '42501';
  end if;

  update public.authentication_identity_links set state = 'active', updated_at = clock_timestamp()
   where provider = 'cognito' and issuer = v_issuer and subject = v_subject
     and tracepoint_user_id = v_user and state = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'rehearsal link promotion lost' using errcode = '42501'; end if;

  update public.department_memberships set activation_status = 'activated', updated_at = clock_timestamp()
   where department_id = v_department and user_id = v_user
     and is_active and activation_status = 'activation_sent';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'rehearsal membership promotion lost' using errcode = '42501'; end if;

  insert into public.authentication_identity_events
    (tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id,operation_id)
  values (v_user,'cognito',v_issuer,v_subject,v_subject,'activated',v_user,v_operation);
  insert into public.audit_events
    (department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
  values (v_department,v_user,'account_activated','department_membership',v_user,
          'Rehearsal invitation activated after verified first Cognito sign-in.',
          jsonb_build_object('identity_provider','cognito','operation_id',v_operation));

  return v_user;
end;
$$;

revoke all on function tracepoint_auth.promote_rehearsal_readington_officer_first_login(text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function tracepoint_auth.promote_rehearsal_readington_officer_first_login(text,text,uuid)
  to tracepoint_runtime;

commit;
