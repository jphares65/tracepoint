begin;

-- A source-schema auth.users trigger may already create the matching profile.
-- Preserve that trigger and require the final profile to match the requested
-- Cognito invite rather than inserting the same primary key twice.
create or replace function tracepoint_auth.prepare_cognito_invite(
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
  insert into public.profiles(id,full_name,email)
    values(p_user_id,btrim(p_full_name),lower(btrim(p_email)))
    on conflict (id) do nothing;
  if not exists (
    select 1 from public.profiles
    where id=p_user_id and full_name=btrim(p_full_name) and lower(email)=lower(btrim(p_email))
  ) then
    raise exception 'invite profile mismatch' using errcode='23505';
  end if;
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

commit;
