-- TracePoint Personally Owned Rifle Workflow v2
-- Idempotent migration: safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.department_rules (
  department_id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.department_rules
  add column if not exists allow_personally_owned_rifles boolean not null default false,
  add column if not exists require_personal_rifle_armorer_inspection boolean not null default true,
  add column if not exists require_personal_rifle_chief_approval boolean not null default true,
  add column if not exists require_personal_rifle_qualification boolean not null default true,
  add column if not exists require_personal_rifle_annual_reinspection boolean not null default true,
  add column if not exists require_personal_rifle_spec_acknowledgment boolean not null default true,
  add column if not exists personal_rifle_approval_months integer not null default 12,
  add column if not exists personal_rifle_policy_text text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists department_rules_department_id_uidx
  on public.department_rules (department_id);

create table if not exists public.personal_rifles (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  manufacturer text not null,
  model text not null,
  serial_number text not null,
  caliber text not null,
  barrel_length text,
  operating_system text,
  stock_brace_configuration text,
  sights_optic text,
  weapon_mounted_light text,
  sling text,
  trigger text,
  muzzle_device text,
  magazine_type text,
  other_modifications text,
  ownership_confirmed boolean not null default false,
  specification_acknowledged boolean not null default false,
  status text not null default 'Draft',
  submitted_at timestamptz,
  armorer_reviewed_by uuid references auth.users(id) on delete set null,
  armorer_reviewed_at timestamptz,
  armorer_decision_notes text,
  armorer_checklist jsonb not null default '{}'::jsonb,
  inspection_date date,
  qualification_verified boolean not null default false,
  qualification_verified_by uuid references auth.users(id) on delete set null,
  qualification_verified_at timestamptz,
  chief_reviewed_by uuid references auth.users(id) on delete set null,
  chief_reviewed_at timestamptz,
  chief_decision_notes text,
  approval_date date,
  expiration_date date,
  correction_notes text,
  suspension_notes text,
  revocation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.personal_rifles
  add column if not exists department_id uuid,
  add column if not exists owner_user_id uuid,
  add column if not exists manufacturer text,
  add column if not exists model text,
  add column if not exists serial_number text,
  add column if not exists caliber text,
  add column if not exists barrel_length text,
  add column if not exists operating_system text,
  add column if not exists stock_brace_configuration text,
  add column if not exists sights_optic text,
  add column if not exists weapon_mounted_light text,
  add column if not exists sling text,
  add column if not exists trigger text,
  add column if not exists muzzle_device text,
  add column if not exists magazine_type text,
  add column if not exists other_modifications text,
  add column if not exists ownership_confirmed boolean not null default false,
  add column if not exists specification_acknowledged boolean not null default false,
  add column if not exists status text not null default 'Draft',
  add column if not exists submitted_at timestamptz,
  add column if not exists armorer_reviewed_by uuid,
  add column if not exists armorer_reviewed_at timestamptz,
  add column if not exists armorer_decision_notes text,
  add column if not exists armorer_checklist jsonb not null default '{}'::jsonb,
  add column if not exists inspection_date date,
  add column if not exists qualification_verified boolean not null default false,
  add column if not exists qualification_verified_by uuid,
  add column if not exists qualification_verified_at timestamptz,
  add column if not exists chief_reviewed_by uuid,
  add column if not exists chief_reviewed_at timestamptz,
  add column if not exists chief_decision_notes text,
  add column if not exists approval_date date,
  add column if not exists expiration_date date,
  add column if not exists correction_notes text,
  add column if not exists suspension_notes text,
  add column if not exists revocation_notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists personal_rifles_department_serial_uidx
  on public.personal_rifles (department_id, lower(serial_number));

create index if not exists personal_rifles_owner_idx
  on public.personal_rifles (department_id, owner_user_id);

create index if not exists personal_rifles_status_idx
  on public.personal_rifles (department_id, status, updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personal_rifles_status_check'
      and conrelid = 'public.personal_rifles'::regclass
  ) then
    alter table public.personal_rifles
      add constraint personal_rifles_status_check
      check (
        status in (
          'Draft',
          'Correction Requested',
          'Pending Armorer Review',
          'Pending Chief Approval',
          'Approved',
          'Armorer Denied',
          'Denied',
          'Suspended',
          'Revoked',
          'Expired'
        )
      ) not valid;
  end if;
end $$;

create table if not exists public.personal_rifle_status_history (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  personal_rifle_id uuid not null references public.personal_rifles(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  from_status text,
  to_status text not null,
  action text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.personal_rifle_status_history
  add column if not exists department_id uuid,
  add column if not exists personal_rifle_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists from_status text,
  add column if not exists to_status text,
  add column if not exists action text,
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create index if not exists personal_rifle_history_record_idx
  on public.personal_rifle_status_history
  (personal_rifle_id, created_at desc);

create or replace function public.tracepoint_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists personal_rifles_set_updated_at
  on public.personal_rifles;
create trigger personal_rifles_set_updated_at
before update on public.personal_rifles
for each row execute function public.tracepoint_set_updated_at();

drop trigger if exists department_rules_set_updated_at
  on public.department_rules;
create trigger department_rules_set_updated_at
before update on public.department_rules
for each row execute function public.tracepoint_set_updated_at();

alter table public.personal_rifles enable row level security;
alter table public.personal_rifle_status_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'personal_rifles'
      and policyname = 'personal_rifles_department_read'
  ) then
    create policy personal_rifles_department_read
      on public.personal_rifles
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.department_memberships membership
          where membership.department_id = personal_rifles.department_id
            and membership.user_id = auth.uid()
            and membership.is_active = true
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'personal_rifles'
      and policyname = 'personal_rifles_owner_insert'
  ) then
    create policy personal_rifles_owner_insert
      on public.personal_rifles
      for insert
      to authenticated
      with check (
        owner_user_id = auth.uid()
        and exists (
          select 1
          from public.department_memberships membership
          where membership.department_id = personal_rifles.department_id
            and membership.user_id = auth.uid()
            and membership.is_active = true
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'personal_rifles'
      and policyname = 'personal_rifles_owner_update'
  ) then
    create policy personal_rifles_owner_update
      on public.personal_rifles
      for update
      to authenticated
      using (
        owner_user_id = auth.uid()
        and status in ('Draft', 'Correction Requested')
      )
      with check (owner_user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'personal_rifle_status_history'
      and policyname = 'personal_rifle_history_department_read'
  ) then
    create policy personal_rifle_history_department_read
      on public.personal_rifle_status_history
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.department_memberships membership
          where membership.department_id =
            personal_rifle_status_history.department_id
            and membership.user_id = auth.uid()
            and membership.is_active = true
        )
      );
  end if;
end $$;

grant select, insert, update on public.personal_rifles to authenticated;
grant select on public.personal_rifle_status_history to authenticated;
