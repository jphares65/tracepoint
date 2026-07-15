create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.firearm_inspections (
  id uuid primary key default gen_random_uuid()
);

alter table public.firearm_inspections
  add column if not exists department_id uuid,
  add column if not exists firearm_id uuid,
  add column if not exists inspection_type text,
  add column if not exists inspection_reason text,
  add column if not exists inspection_date timestamptz not null default now(),
  add column if not exists inspector_name text,
  add column if not exists inspection_location text,
  add column if not exists assignee_name text,
  add column if not exists weapon_cleared text,
  add column if not exists ammunition_removed text,
  add column if not exists magazines_presented text,
  add column if not exists round_count text,
  add column if not exists optic_battery_status text,
  add column if not exists cleaning_condition text,
  add column if not exists result text,
  add column if not exists service_recommendation text,
  add column if not exists follow_up_date date,
  add column if not exists corrective_action text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'firearm_inspections_firearm_id_fkey'
  ) then
    alter table public.firearm_inspections
      add constraint firearm_inspections_firearm_id_fkey
      foreign key (firearm_id)
      references public.firearms(id)
      on delete cascade;
  end if;
end;
$$;

create table if not exists public.firearm_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.firearm_inspections(id) on delete cascade,
  section text,
  label text not null,
  status text not null,
  note text,
  critical boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists firearm_inspections_department_id_idx
  on public.firearm_inspections(department_id);

create index if not exists firearm_inspections_firearm_id_idx
  on public.firearm_inspections(firearm_id);

create index if not exists firearm_inspections_date_idx
  on public.firearm_inspections(inspection_date desc);

create index if not exists firearm_inspections_result_idx
  on public.firearm_inspections(result);

create index if not exists firearm_inspection_items_inspection_id_idx
  on public.firearm_inspection_items(inspection_id);

drop trigger if exists set_firearm_inspections_updated_at
  on public.firearm_inspections;

create trigger set_firearm_inspections_updated_at
before update on public.firearm_inspections
for each row
execute function public.set_updated_at();