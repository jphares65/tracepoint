begin;

-- Cognito passwords and global sign-out affect the identity everywhere it is
-- used. Reject protected or multi-department targets before the lifecycle
-- operation is recorded or any session revocation is performed.
create or replace function tracepoint_auth.guard_cognito_password_global_scope()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,tracepoint_auth
as $$
begin
  if new.operation_kind in ('assign_password','reset_password') then
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

revoke all on function tracepoint_auth.guard_cognito_password_global_scope()
  from public,anon,authenticated,service_role,tracepoint_runtime;

create trigger authentication_lifecycle_password_global_scope
before insert on public.authentication_lifecycle_operations
for each row
execute function tracepoint_auth.guard_cognito_password_global_scope();

commit;