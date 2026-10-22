begin;

-- F1 (owner decisions on personnel re-import). Same signatures and grants as 010
-- and 039; create or replace keeps the existing grants, restated below.

-- A blank import field keeps the stored value, and the default Officer role is
-- given only to a membership this import creates; an existing member's roles
-- are never changed.
create or replace function public.attach_existing_cognito_personnel_import(
  p_department_id uuid,p_email text,p_full_name text,p_badge_number text,
  p_employee_number text,p_rank_title text,p_unit_name text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_actor uuid:=tracepoint_auth.subject_id(); v_user_id uuid; v_identity_state text; v_matches integer; v_created boolean;
begin
  if session_user<>'tracepoint_runtime' or v_actor is null
     or current_setting('tracepoint.department_id',true) is distinct from p_department_id::text
     or not (public.has_department_permission(p_department_id,'manage_users') or public.has_department_permission(p_department_id,'administer_department')) then
    raise exception 'personnel association forbidden' using errcode='42501';
  end if;
  select count(*)::integer,(array_agg(q.id))[1],(array_agg(q.state))[1]
  into v_matches,v_user_id,v_identity_state
  from (
    select p.id,max(l.state) as state
    from public.profiles p
    join public.authentication_identity_links l on l.tracepoint_user_id=p.id and l.provider='cognito' and l.state in ('pending','active')
    where lower(p.email)=lower(btrim(p_email))
    group by p.id
  ) q;
  if v_matches>1 then raise exception 'ambiguous cognito identity' using errcode='21000'; end if;
  if v_user_id is null then return null; end if;
  insert into public.department_memberships as m(
    department_id,user_id,badge_number,employee_number,rank_title,unit_name,is_active,deactivated_at,activation_status
  ) values(
    p_department_id,v_user_id,nullif(btrim(p_badge_number),''),nullif(btrim(p_employee_number),''),
    nullif(btrim(p_rank_title),''),nullif(btrim(p_unit_name),''),false,clock_timestamp(),'activated'
  ) on conflict(department_id,user_id) do update set
    badge_number=coalesce(excluded.badge_number,m.badge_number),employee_number=coalesce(excluded.employee_number,m.employee_number),
    rank_title=coalesce(excluded.rank_title,m.rank_title),unit_name=coalesce(excluded.unit_name,m.unit_name)
  returning (xmax=0) into v_created;
  if v_created then
    insert into public.department_membership_roles(department_id,user_id,role_code,assigned_by)
      values(p_department_id,v_user_id,'officer',v_actor)
      on conflict(department_id,user_id,role_code) do nothing;
  end if;
  update public.profiles set full_name=btrim(p_full_name) where id=v_user_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
    values(p_department_id,v_actor,'existing_cognito_user_added_by_personnel_import','department_membership',v_user_id,
      'An existing Cognito identity was associated through the approved personnel import.',
      jsonb_build_object('target_user_id',v_user_id,'identity_provider','cognito'));
  return jsonb_build_object('user_id',v_user_id,'identity_state',v_identity_state);
end;
$$;

-- A blank import field keeps the stored value (as the bridge importer does).
create or replace function public.update_cognito_personnel_import(
  p_department_id uuid,p_user_id uuid,p_email text,p_full_name text,p_phone text,
  p_badge_number text,p_employee_number text,p_rank_title text,p_unit_name text
) returns text
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_actor uuid:=tracepoint_auth.subject_id(); v_current_email text; v_identity_state text;
begin
  if session_user<>'tracepoint_runtime' or v_actor is null
     or current_setting('tracepoint.department_id',true) is distinct from p_department_id::text
     or not (public.has_department_permission(p_department_id,'manage_users') or public.has_department_permission(p_department_id,'administer_department')) then
    raise exception 'personnel update forbidden' using errcode='42501';
  end if;
  select p.email into v_current_email from public.profiles p
  join public.department_memberships m on m.user_id=p.id and m.department_id=p_department_id
  where p.id=p_user_id for update of p,m;
  if not found then raise exception 'personnel membership unavailable' using errcode='P0002'; end if;
  if lower(v_current_email) is distinct from lower(btrim(p_email)) then
    raise exception 'identity email changes require the dedicated Cognito workflow' using errcode='22023';
  end if;
  update public.profiles set full_name=btrim(p_full_name),phone=coalesce(nullif(btrim(p_phone),''),phone) where id=p_user_id;
  update public.department_memberships set
    badge_number=coalesce(nullif(btrim(p_badge_number),''),badge_number),employee_number=coalesce(nullif(btrim(p_employee_number),''),employee_number),
    rank_title=coalesce(nullif(btrim(p_rank_title),''),rank_title),unit_name=coalesce(nullif(btrim(p_unit_name),''),unit_name)
  where department_id=p_department_id and user_id=p_user_id;
  select l.state into v_identity_state from public.authentication_identity_links l
    where l.tracepoint_user_id=p_user_id and l.provider='cognito' and l.state in ('pending','active') limit 1;
  if v_identity_state is null then raise exception 'cognito identity unavailable' using errcode='P0002'; end if;
  return v_identity_state;
end;
$$;

-- An import row with Active=No (or Yes) reaches the membership lifecycle
-- directly. Self-deactivation (010 trigger) and the final Administrator
-- (protect_final_administrator_membership) are already refused there; the
-- Administrator-only rule was not. 039's body plus that one check.
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
  -- The rule update_department_member applies: personnel import reaches this
  -- function without it.
  if not public.has_department_permission(p_department_id,'administer_department') and exists(
    select 1 from public.department_membership_roles r
    where r.department_id=p_department_id and r.user_id=p_target_user_id and r.role_code='administrator') then
    raise exception 'Only a department Administrator may modify an Administrator account.' using errcode='42501';
  end if;
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

revoke all on function public.attach_existing_cognito_personnel_import(uuid,text,text,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.attach_existing_cognito_personnel_import(uuid,text,text,text,text,text,text) to authenticated;
revoke all on function public.update_cognito_personnel_import(uuid,uuid,text,text,text,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.update_cognito_personnel_import(uuid,uuid,text,text,text,text,text,text,text) to authenticated;
revoke all on function tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid) from public,anon,service_role;
grant execute on function tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid) to authenticated;

commit;
