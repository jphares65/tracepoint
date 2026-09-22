begin;

-- Exceptional identity migration remains behind the same authenticated
-- platform-administrator boundary as the platform control plane. These
-- SECURITY DEFINER functions expose only the minimum cohort metadata and
-- atomic link operation needed by the one-shot migration runner; the runtime
-- role cannot invoke them without SET ROLE authenticated and a valid subject.
create function tracepoint_auth.list_exceptional_cognito_identities()
returns table(target_user_id uuid, disposition text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'tracepoint_runtime'
     or tracepoint_auth.subject_id() is null
     or not public.is_platform_admin() then
    raise exception 'exceptional identity discovery forbidden' using errcode = '42501';
  end if;

  return query
  select profile.id,
    case
      when exists (
        select 1 from public.platform_admins administrator
        where administrator.user_id = profile.id and administrator.is_active
      ) and not exists (
        select 1 from public.department_memberships membership
        where membership.user_id = profile.id
      ) then 'platform-administrator'::text
      else 'inactive-disabled'::text
    end
  from public.profiles profile
  where nullif(btrim(profile.email), '') is not null
    and nullif(btrim(profile.full_name), '') is not null
    and (select count(*) from public.profiles candidate where lower(btrim(candidate.email)) = lower(btrim(profile.email))) = 1
    and not exists (
      select 1 from public.authentication_identity_links link
      where link.provider = 'cognito' and link.tracepoint_user_id = profile.id
    )
    and (
      (
        exists (
          select 1 from public.platform_admins administrator
          where administrator.user_id = profile.id and administrator.is_active
        ) and not exists (
          select 1 from public.department_memberships membership
          where membership.user_id = profile.id
        )
      ) or (
        exists (
          select 1 from public.department_memberships membership
          where membership.user_id = profile.id
        ) and not exists (
          select 1 from public.department_memberships membership
          where membership.user_id = profile.id and membership.is_active
        ) and not exists (
          select 1 from public.platform_admins administrator
          where administrator.user_id = profile.id and administrator.is_active
        )
      )
    )
  order by profile.id;
end;
$$;

create function tracepoint_auth.prepare_exceptional_cognito_migration(
  p_target_user_id uuid,
  p_disposition text
) returns table(email text, full_name text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text;
  v_full_name text;
begin
  if session_user <> 'tracepoint_runtime'
     or tracepoint_auth.subject_id() is null
     or not public.is_platform_admin()
     or p_target_user_id is null
     or p_disposition not in ('inactive-disabled', 'platform-administrator') then
    raise exception 'exceptional identity migration forbidden' using errcode = '42501';
  end if;

  if (p_disposition = 'platform-administrator' and not (
       exists (select 1 from public.platform_admins administrator where administrator.user_id = p_target_user_id and administrator.is_active)
       and not exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id)
     )) or (p_disposition = 'inactive-disabled' and not (
       exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id)
       and not exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id and membership.is_active)
       and not exists (select 1 from public.platform_admins administrator where administrator.user_id = p_target_user_id and administrator.is_active)
     )) then
    raise exception 'exceptional identity target unavailable' using errcode = 'P0002';
  end if;

  select lower(btrim(profile.email)), btrim(profile.full_name)
    into v_email, v_full_name
  from public.profiles profile
  where profile.id = p_target_user_id
  for update;
  if nullif(v_email, '') is null or nullif(v_full_name, '') is null then
    raise exception 'exceptional identity profile incomplete' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles profile where lower(btrim(profile.email)) = v_email) <> 1 then
    raise exception 'exceptional identity email ambiguous' using errcode = '21000';
  end if;
  return query select v_email, v_full_name;
end;
$$;

create function tracepoint_auth.commit_exceptional_cognito_migration(
  p_target_user_id uuid,
  p_disposition text,
  p_issuer text,
  p_subject text,
  p_provider_username text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_state text := case when p_disposition = 'inactive-disabled' then 'revoked' else 'pending' end;
  v_actor uuid := tracepoint_auth.subject_id();
  v_existing public.authentication_identity_links%rowtype;
begin
  if session_user <> 'tracepoint_runtime'
     or v_actor is null
     or not public.is_platform_admin()
     or p_target_user_id is null
     or p_disposition not in ('inactive-disabled', 'platform-administrator')
     or p_provider_username is distinct from p_target_user_id::text
     or nullif(btrim(p_subject), '') is null
     or p_issuer !~ '^https://cognito-idp[.]us-east-1[.]amazonaws[.]com/us-east-1_[A-Za-z0-9]+$' then
    raise exception 'exceptional identity migration commit forbidden' using errcode = '42501';
  end if;

  if (p_disposition = 'platform-administrator' and not (
       exists (select 1 from public.platform_admins administrator where administrator.user_id = p_target_user_id and administrator.is_active)
       and not exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id)
     )) or (p_disposition = 'inactive-disabled' and not (
       exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id)
       and not exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id and membership.is_active)
       and not exists (select 1 from public.platform_admins administrator where administrator.user_id = p_target_user_id and administrator.is_active)
     )) then
    raise exception 'exceptional identity eligibility changed' using errcode = 'P0002';
  end if;

  perform 1 from public.profiles profile where profile.id = p_target_user_id for update;
  if not found then raise exception 'exceptional identity profile unavailable' using errcode = 'P0002'; end if;
  if not exists (
       select 1 from public.profiles profile
       where profile.id = p_target_user_id
         and nullif(btrim(profile.email), '') is not null
         and nullif(btrim(profile.full_name), '') is not null
     ) or (select count(*) from public.profiles profile
           where lower(btrim(profile.email)) = (
             select lower(btrim(target.email)) from public.profiles target where target.id = p_target_user_id
           )) <> 1 then
    raise exception 'exceptional identity profile changed' using errcode = '21000';
  end if;
  select * into v_existing from public.authentication_identity_links
    where provider = 'cognito' and tracepoint_user_id = p_target_user_id
    for update;
  if found then
    if v_existing.issuer is distinct from p_issuer
       or v_existing.subject is distinct from p_subject
       or v_existing.state is distinct from v_state
       or v_existing.provider_username is distinct from p_provider_username then
      raise exception 'exceptional identity link mismatch' using errcode = '23505';
    end if;
    return;
  end if;

  insert into public.authentication_identity_links(provider, issuer, subject, tracepoint_user_id, state, provider_username)
  values ('cognito', p_issuer, p_subject, p_target_user_id, v_state, p_provider_username);
  insert into public.authentication_identity_events(
    tracepoint_user_id, provider, issuer, subject, provider_username, event_type, actor_user_id
  ) values (
    p_target_user_id, 'cognito', p_issuer, p_subject, p_provider_username,
    case when v_state = 'revoked' then 'revoked' else 'linked' end, v_actor
  );
end;
$$;

create function tracepoint_auth.read_exceptional_cognito_migration(
  p_target_user_id uuid,
  p_disposition text
) returns table(issuer text, subject text, state text, provider_username text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'tracepoint_runtime'
     or tracepoint_auth.subject_id() is null
     or not public.is_platform_admin()
     or p_target_user_id is null
     or p_disposition not in ('inactive-disabled', 'platform-administrator') then
    raise exception 'exceptional identity reconciliation forbidden' using errcode = '42501';
  end if;

  if (p_disposition = 'platform-administrator' and not (
       exists (select 1 from public.platform_admins administrator where administrator.user_id = p_target_user_id and administrator.is_active)
       and not exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id)
     )) or (p_disposition = 'inactive-disabled' and not (
       exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id)
       and not exists (select 1 from public.department_memberships membership where membership.user_id = p_target_user_id and membership.is_active)
       and not exists (select 1 from public.platform_admins administrator where administrator.user_id = p_target_user_id and administrator.is_active)
     )) then
    raise exception 'exceptional identity reconciliation target unavailable' using errcode = 'P0002';
  end if;

  return query
  select link.issuer, link.subject, link.state, link.provider_username
  from public.authentication_identity_links link
  where link.provider = 'cognito'
    and link.tracepoint_user_id = p_target_user_id
    and link.state = case when p_disposition = 'inactive-disabled' then 'revoked' else 'pending' end;
end;
$$;

revoke all on function tracepoint_auth.list_exceptional_cognito_identities() from public, anon, service_role, tracepoint_runtime;
revoke all on function tracepoint_auth.prepare_exceptional_cognito_migration(uuid, text) from public, anon, service_role, tracepoint_runtime;
revoke all on function tracepoint_auth.commit_exceptional_cognito_migration(uuid, text, text, text, text) from public, anon, service_role, tracepoint_runtime;
revoke all on function tracepoint_auth.read_exceptional_cognito_migration(uuid, text) from public, anon, service_role, tracepoint_runtime;
grant execute on function tracepoint_auth.list_exceptional_cognito_identities() to authenticated;
grant execute on function tracepoint_auth.prepare_exceptional_cognito_migration(uuid, text) to authenticated;
grant execute on function tracepoint_auth.commit_exceptional_cognito_migration(uuid, text, text, text, text) to authenticated;
grant execute on function tracepoint_auth.read_exceptional_cognito_migration(uuid, text) to authenticated;

commit;
