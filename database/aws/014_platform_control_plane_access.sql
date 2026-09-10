begin;

create function public.list_platform_agencies()
returns table(
  id uuid,
  name text,
  short_name text,
  slug text,
  state text,
  county text,
  agency_type text,
  timezone text,
  sworn_officers integer,
  civilian_staff integer,
  is_active boolean,
  created_at timestamptz,
  account_status text,
  plan_type text,
  onboarding_status text,
  pilot_start_date date,
  production_start_date date,
  internal_notes text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if session_user <> 'tracepoint_runtime'
     or tracepoint_auth.subject_id() is null
     or not public.is_platform_admin() then
    raise exception 'platform administrator access required' using errcode = '42501';
  end if;
  return query
  select department.id, department.name, department.short_name, department.slug,
    department.state, department.county, department.agency_type, department.timezone,
    department.sworn_officers, department.civilian_staff, department.is_active, department.created_at,
    account.account_status, account.plan_type, account.onboarding_status,
    account.pilot_start_date, account.production_start_date, account.internal_notes
  from public.departments department
  left join public.platform_agency_accounts account on account.department_id = department.id
  order by department.name, department.id;
end;
$$;

revoke all on function public.list_platform_agencies() from public, anon, service_role;
grant execute on function public.list_platform_agencies() to authenticated;

commit;
