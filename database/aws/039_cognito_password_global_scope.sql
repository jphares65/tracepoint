begin;

-- Password reset and global sign-out affect every use of a Cognito identity.
-- Lock the identity while preparing the operation, and prevent its global
-- scope from changing until the provider call has been finalized. A crash or
-- ambiguous provider failure can leave the operation non-committed; the app
-- has no automatic reconciliation path, so that state remains held. Do not
-- clear the hold without independently resolving the Cognito outcome.
create or replace function tracepoint_auth.guard_cognito_password_global_scope()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,tracepoint_auth
as $$
begin
  if new.operation_kind in ('assign_password','reset_password') then
    perform pg_advisory_xact_lock(hashtextextended(new.tracepoint_user_id::text, 0));

    if exists (
      select 1
      from public.platform_admins administrator
      where administrator.user_id = new.tracepoint_user_id
        and administrator.is_active
    ) then
      raise exception 'password operation target is a platform administrator'
        using errcode='42501';
    end if;

    if exists (
      select 1
      from public.department_memberships membership
      where membership.user_id = new.tracepoint_user_id
        and membership.department_id <> new.department_id
    ) then
      raise exception 'password operation target has another department membership'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function tracepoint_auth.guard_cognito_scope_membership_write()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,tracepoint_auth
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  if exists (
    select 1
    from public.authentication_lifecycle_operations operation
    where operation.tracepoint_user_id = new.user_id
      and operation.operation_kind in ('assign_password','reset_password')
      and operation.state <> 'committed'
      and operation.department_id <> new.department_id
  ) then
    raise exception 'membership scope change conflicts with an unresolved password operation'
      using errcode='42501';
  end if;

  return new;
end;
$$;

create or replace function tracepoint_auth.guard_cognito_scope_platform_admin_write()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,tracepoint_auth
as $$
begin
  if new.is_active then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

    if exists (
      select 1
      from public.authentication_lifecycle_operations operation
      where operation.tracepoint_user_id = new.user_id
        and operation.operation_kind in ('assign_password','reset_password')
        and operation.state <> 'committed'
    ) then
      raise exception 'platform administrator scope change conflicts with an unresolved password operation'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function tracepoint_auth.guard_cognito_password_global_scope()
  from public,anon,authenticated,service_role,tracepoint_runtime;
revoke all on function tracepoint_auth.guard_cognito_scope_membership_write()
  from public,anon,authenticated,service_role,tracepoint_runtime;
revoke all on function tracepoint_auth.guard_cognito_scope_platform_admin_write()
  from public,anon,authenticated,service_role,tracepoint_runtime;

create trigger authentication_lifecycle_password_global_scope
before insert on public.authentication_lifecycle_operations
for each row
execute function tracepoint_auth.guard_cognito_password_global_scope();

create trigger department_memberships_password_scope_guard
before insert or update on public.department_memberships
for each row
execute function tracepoint_auth.guard_cognito_scope_membership_write();

create trigger platform_admins_password_scope_guard
before insert or update on public.platform_admins
for each row
execute function tracepoint_auth.guard_cognito_scope_platform_admin_write();

commit;
