-- Keep the final-Administrator invariant for active departments while allowing
-- an authorized parent department deletion to cascade through its memberships.
create or replace function public.protect_final_department_administrator()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  loses_administrator boolean := false;
  protected_department_id uuid;
  protected_user_id uuid;
begin
  if tg_table_name = 'department_membership_roles' then
    protected_department_id := old.department_id;
    protected_user_id := old.user_id;
    loses_administrator := old.role_code = 'administrator'
      and (tg_op = 'DELETE' or new.role_code is distinct from 'administrator'
        or new.department_id is distinct from old.department_id or new.user_id is distinct from old.user_id);
  else
    protected_department_id := old.department_id;
    protected_user_id := old.user_id;
    loses_administrator := exists (
      select 1 from public.department_membership_roles role
      where role.department_id = old.department_id and role.user_id = old.user_id and role.role_code = 'administrator'
    ) and (tg_op = 'DELETE' or new.is_active = false or new.department_id is distinct from old.department_id or new.user_id is distinct from old.user_id);
  end if;

  if loses_administrator
    and exists (
      select 1 from public.departments department
      where department.id = protected_department_id
    )
    and exists (
      select 1 from public.department_memberships member
      where member.department_id = protected_department_id and member.user_id = protected_user_id and member.is_active
    )
    and not exists (
      select 1 from public.department_membership_roles role
      join public.department_memberships member using (department_id, user_id)
      where role.department_id = protected_department_id and role.role_code = 'administrator'
        and role.user_id <> protected_user_id and member.is_active
    )
  then
    raise exception using errcode = '23514', message = 'The department must retain at least one active Administrator.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
