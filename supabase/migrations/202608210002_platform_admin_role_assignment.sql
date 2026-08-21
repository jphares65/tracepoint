create or replace function public.set_department_member_roles(
  p_department_id uuid,
  p_user_id uuid,
  p_role_codes text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_can_manage boolean;
  v_is_platform_admin boolean;
begin
  select
    public.has_department_permission(
      p_department_id,
      'manage_users'
    )
    or public.has_department_permission(
      p_department_id,
      'administer_department'
    )
  into v_can_manage;

  select public.is_platform_admin()
  into v_is_platform_admin;

  if not coalesce(v_can_manage, false)
     and not coalesce(v_is_platform_admin, false) then
    raise exception 'Not authorized to manage department roles';
  end if;

  delete from public.department_membership_roles
  where department_id = p_department_id
    and user_id = p_user_id;

  insert into public.department_membership_roles (
    department_id,
    user_id,
    role_code,
    assigned_by
  )
  select
    p_department_id,
    p_user_id,
    role_code,
    auth.uid()
  from unnest(p_role_codes) as role_code;
end;
$$;

revoke all on function public.set_department_member_roles(uuid, uuid, text[]) from public;
grant execute on function public.set_department_member_roles(uuid, uuid, text[]) to authenticated;
