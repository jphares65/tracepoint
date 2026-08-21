begin;

alter table public.department_memberships
  add column if not exists activation_status text;

update public.department_memberships
set activation_status = 'activated'
where activation_status is null;

alter table public.department_memberships
  alter column activation_status set default 'activated';

alter table public.department_memberships
  alter column activation_status set not null;

alter table public.department_memberships
  drop constraint if exists department_memberships_activation_status_check;

alter table public.department_memberships
  add constraint department_memberships_activation_status_check
  check (
    activation_status in (
      'pending_activation',
      'activation_sent',
      'activated'
    )
  );

drop function if exists public.get_department_members(uuid);

create function public.get_department_members(
  p_department_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  badge_number text,
  rank_title text,
  unit_name text,
  employee_number text,
  is_active boolean,
  joined_at timestamptz,
  activation_status text,
  role_codes text[],
  effective_permissions text[]
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not (
    public.has_department_permission(
      p_department_id,
      'manage_users'
    )
    or public.has_department_permission(
      p_department_id,
      'administer_department'
    )
  ) then
    raise exception
      'You do not have permission to manage department users.';
  end if;

  return query
  select
    membership.user_id,
    profile.full_name,
    profile.email,
    membership.badge_number,
    membership.rank_title,
    membership.unit_name,
    membership.employee_number,
    membership.is_active,
    membership.joined_at,
    membership.activation_status,
    coalesce(
      array_agg(distinct membership_role.role_code)
        filter (
          where membership_role.role_code is not null
        ),
      array[]::text[]
    ) as role_codes,
    coalesce(
      array_agg(distinct role_permission.permission_code)
        filter (
          where role_permission.permission_code is not null
        ),
      array[]::text[]
    ) as effective_permissions
  from public.department_memberships membership
  join public.profiles profile
    on profile.id = membership.user_id
  left join public.department_membership_roles membership_role
    on membership_role.department_id =
      membership.department_id
   and membership_role.user_id =
      membership.user_id
  left join public.department_role_permissions role_permission
    on role_permission.department_id =
      membership.department_id
   and role_permission.role_code =
      membership_role.role_code
  where membership.department_id = p_department_id
  group by
    membership.user_id,
    profile.full_name,
    profile.email,
    membership.badge_number,
    membership.rank_title,
    membership.unit_name,
    membership.employee_number,
    membership.is_active,
    membership.joined_at,
    membership.activation_status
  order by profile.full_name;
end;
$$;

revoke all on function
  public.get_department_members(uuid)
from public;

grant execute on function
  public.get_department_members(uuid)
to authenticated;

commit;
