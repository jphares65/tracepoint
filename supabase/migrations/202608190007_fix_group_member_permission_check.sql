create or replace function public.set_department_group_members(
  p_department_id uuid,
  p_user_id uuid,
  p_group_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not (
    public.has_department_permission(
      p_department_id,
      'manage_users'
    )
    or
    public.has_department_permission(
      p_department_id,
      'administer_department'
    )
  ) then
    raise exception 'You do not have permission to manage department member assignments.';
  end if;

  if not exists (
    select 1
    from public.department_memberships dm
    where dm.department_id = p_department_id
      and dm.user_id = p_user_id
  ) then
    raise exception 'The selected user is not a member of this department.';
  end if;

  foreach v_group_id in array coalesce(
    p_group_ids,
    array[]::uuid[]
  )
  loop
    if not exists (
      select 1
      from public.department_groups dg
      where dg.id = v_group_id
        and dg.department_id = p_department_id
        and dg.is_active = true
    ) then
      raise exception 'One or more selected groups are invalid or inactive.';
    end if;
  end loop;

  delete from public.department_group_members
  where department_id = p_department_id
    and user_id = p_user_id;

  insert into public.department_group_members (
    department_id,
    group_id,
    user_id,
    assigned_by
  )
  select
    p_department_id,
    group_id,
    p_user_id,
    auth.uid()
  from unnest(
    coalesce(p_group_ids, array[]::uuid[])
  ) as group_id;
end;
$$;

revoke all on function public.set_department_group_members(
  uuid,
  uuid,
  uuid[]
) from public;

grant execute on function public.set_department_group_members(
  uuid,
  uuid,
  uuid[]
) to authenticated;
