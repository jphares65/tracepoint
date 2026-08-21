create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_agency_accounts (
  department_id uuid primary key
    references public.departments(id) on delete cascade,
  account_status text not null default 'onboarding',
  plan_type text not null default 'pilot',
  onboarding_status text not null default 'agency_created',
  pilot_start_date date,
  production_start_date date,
  internal_notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_agency_accounts_status_check
    check (
      account_status in (
        'onboarding',
        'pilot',
        'active',
        'suspended',
        'inactive'
      )
    ),

  constraint platform_agency_accounts_plan_check
    check (
      plan_type in (
        'pilot',
        'lifetime_free',
        'paid',
        'internal'
      )
    )
);

alter table public.platform_admins enable row level security;
alter table public.platform_agency_accounts enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins
    where user_id = auth.uid()
      and is_active = true
  );
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

drop policy if exists "Platform admins can view platform admins"
  on public.platform_admins;

create policy "Platform admins can view platform admins"
on public.platform_admins
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "Platform admins can view agency accounts"
  on public.platform_agency_accounts;

create policy "Platform admins can view agency accounts"
on public.platform_agency_accounts
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "Platform admins can create agency accounts"
  on public.platform_agency_accounts;

create policy "Platform admins can create agency accounts"
on public.platform_agency_accounts
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "Platform admins can update agency accounts"
  on public.platform_agency_accounts;

create policy "Platform admins can update agency accounts"
on public.platform_agency_accounts
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create or replace function public.platform_create_agency(
  p_name text,
  p_short_name text,
  p_slug text,
  p_state text default null,
  p_county text default null,
  p_agency_type text default 'Municipal Police Department',
  p_timezone text default 'America/New_York',
  p_sworn_officers integer default 0,
  p_civilian_staff integer default 0,
  p_account_status text default 'pilot',
  p_plan_type text default 'pilot',
  p_internal_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required';
  end if;

  insert into public.departments (
    name,
    short_name,
    slug,
    state,
    county,
    agency_type,
    timezone,
    sworn_officers,
    civilian_staff,
    is_active,
    created_by
  )
  values (
    btrim(p_name),
    nullif(btrim(p_short_name), ''),
    lower(btrim(p_slug)),
    nullif(btrim(p_state), ''),
    nullif(btrim(p_county), ''),
    coalesce(nullif(btrim(p_agency_type), ''), 'Municipal Police Department'),
    coalesce(nullif(btrim(p_timezone), ''), 'America/New_York'),
    greatest(coalesce(p_sworn_officers, 0), 0),
    greatest(coalesce(p_civilian_staff, 0), 0),
    true,
    auth.uid()
  )
  returning id into v_department_id;

  insert into public.platform_agency_accounts (
    department_id,
    account_status,
    plan_type,
    onboarding_status,
    pilot_start_date,
    internal_notes,
    created_by
  )
  values (
    v_department_id,
    coalesce(nullif(btrim(p_account_status), ''), 'pilot'),
    coalesce(nullif(btrim(p_plan_type), ''), 'pilot'),
    'agency_created',
    case
      when coalesce(nullif(btrim(p_account_status), ''), 'pilot') = 'pilot'
        then current_date
      else null
    end,
    nullif(btrim(p_internal_notes), ''),
    auth.uid()
  );

  return v_department_id;
end;
$$;

revoke all on function public.platform_create_agency(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text
) from public;

grant execute on function public.platform_create_agency(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text
) to authenticated;
