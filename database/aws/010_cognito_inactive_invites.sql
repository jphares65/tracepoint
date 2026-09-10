begin;

create function tracepoint_auth.prevent_self_membership_deactivation()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if old.is_active and not new.is_active and old.user_id=tracepoint_auth.subject_id() then
    raise exception 'self deactivation is not permitted' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger department_memberships_prevent_self_deactivation
before update of is_active on public.department_memberships
for each row execute function tracepoint_auth.prevent_self_membership_deactivation();

create function tracepoint_auth.prepare_cognito_invite(
  p_user_id uuid,p_operation_id uuid,p_provider_username text,p_department_id uuid,
  p_email text,p_full_name text,p_badge_number text,p_rank_title text,p_unit_name text,p_employee_number text,
  p_role_codes text[],p_group_ids uuid[],p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_actor uuid:=tracepoint_auth.subject_id();
begin
  if session_user<>'tracepoint_runtime' or v_actor is null or nullif(btrim(p_email),'') is null
     or nullif(btrim(p_full_name),'') is null or coalesce(array_length(p_role_codes,1),0)=0
     or p_is_active is null then
    raise exception 'invite rejected' using errcode='22023';
  end if;
  if current_setting('tracepoint.department_id',true) is distinct from p_department_id::text
     or not (public.has_department_permission(p_department_id,'manage_users') or public.has_department_permission(p_department_id,'administer_department')) then
    raise exception 'invite forbidden' using errcode='42501';
  end if;
  if 'administrator'=any(p_role_codes) and not public.has_department_permission(p_department_id,'administer_department') then
    raise exception 'administrator assignment forbidden' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where lower(email)=lower(btrim(p_email))) then
    raise exception 'explicit existing identity selection required' using errcode='23505';
  end if;
  if (select count(*) from public.roles where code=any(p_role_codes))<>cardinality(p_role_codes) then
    raise exception 'invalid roles' using errcode='22023';
  end if;
  if exists(select 1 from unnest(coalesce(p_group_ids,array[]::uuid[])) g
    where not exists(select 1 from public.department_groups d where d.id=g and d.department_id=p_department_id and d.is_active)) then
    raise exception 'invalid groups' using errcode='22023';
  end if;
  insert into auth.users(id,email,raw_user_meta_data)
    values(p_user_id,lower(btrim(p_email)),jsonb_build_object('full_name',btrim(p_full_name),'identity_provider','cognito'));
  insert into public.profiles(id,full_name,email) values(p_user_id,btrim(p_full_name),lower(btrim(p_email)));
  insert into public.department_memberships(
    department_id,user_id,badge_number,rank_title,unit_name,employee_number,is_active,deactivated_at,activation_status
  ) values(
    p_department_id,p_user_id,nullif(btrim(p_badge_number),''),nullif(btrim(p_rank_title),''),
    nullif(btrim(p_unit_name),''),nullif(btrim(p_employee_number),''),p_is_active,
    case when p_is_active then null else clock_timestamp() end,'pending_activation'
  );
  insert into public.department_membership_roles(department_id,user_id,role_code)
    select p_department_id,p_user_id,unnest(p_role_codes);
  insert into public.department_group_members(department_id,group_id,user_id,assigned_by)
    select p_department_id,unnest(coalesce(p_group_ids,array[]::uuid[])),p_user_id,v_actor;
  insert into public.authentication_lifecycle_operations(
    id,operation_kind,tracepoint_user_id,department_id,actor_user_id,provider_username,state
  ) values(p_operation_id,'invite',p_user_id,p_department_id,v_actor,p_provider_username,'prepared');
end;
$$;

revoke all on function tracepoint_auth.prepare_cognito_invite(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],uuid[],boolean)
  from public,anon,service_role;
grant execute on function tracepoint_auth.prepare_cognito_invite(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],uuid[],boolean)
  to authenticated;

create function public.attach_existing_cognito_personnel_import(
  p_department_id uuid,p_email text,p_full_name text,p_badge_number text,
  p_employee_number text,p_rank_title text,p_unit_name text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_actor uuid:=tracepoint_auth.subject_id(); v_user_id uuid; v_identity_state text; v_matches integer;
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
  insert into public.department_memberships(
    department_id,user_id,badge_number,employee_number,rank_title,unit_name,is_active,deactivated_at,activation_status
  ) values(
    p_department_id,v_user_id,nullif(btrim(p_badge_number),''),nullif(btrim(p_employee_number),''),
    nullif(btrim(p_rank_title),''),nullif(btrim(p_unit_name),''),false,clock_timestamp(),'activated'
  ) on conflict(department_id,user_id) do update set
    badge_number=excluded.badge_number,employee_number=excluded.employee_number,
    rank_title=excluded.rank_title,unit_name=excluded.unit_name;
  insert into public.department_membership_roles(department_id,user_id,role_code,assigned_by)
    values(p_department_id,v_user_id,'officer',v_actor)
    on conflict(department_id,user_id,role_code) do nothing;
  update public.profiles set full_name=btrim(p_full_name) where id=v_user_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
    values(p_department_id,v_actor,'existing_cognito_user_added_by_personnel_import','department_membership',v_user_id,
      'An existing Cognito identity was associated through the approved personnel import.',
      jsonb_build_object('target_user_id',v_user_id,'identity_provider','cognito'));
  return jsonb_build_object('user_id',v_user_id,'identity_state',v_identity_state);
end;
$$;

create function public.update_cognito_personnel_import(
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
  update public.profiles set full_name=btrim(p_full_name),phone=nullif(btrim(p_phone),'') where id=p_user_id;
  update public.department_memberships set
    badge_number=nullif(btrim(p_badge_number),''),employee_number=nullif(btrim(p_employee_number),''),
    rank_title=nullif(btrim(p_rank_title),''),unit_name=nullif(btrim(p_unit_name),'')
  where department_id=p_department_id and user_id=p_user_id;
  select l.state into v_identity_state from public.authentication_identity_links l
    where l.tracepoint_user_id=p_user_id and l.provider='cognito' and l.state in ('pending','active') limit 1;
  if v_identity_state is null then raise exception 'cognito identity unavailable' using errcode='P0002'; end if;
  return v_identity_state;
end;
$$;

revoke all on function public.attach_existing_cognito_personnel_import(uuid,text,text,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.attach_existing_cognito_personnel_import(uuid,text,text,text,text,text,text) to authenticated;
revoke all on function public.update_cognito_personnel_import(uuid,uuid,text,text,text,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.update_cognito_personnel_import(uuid,uuid,text,text,text,text,text,text,text) to authenticated;

commit;
