-- Certification catalog tables predated their tracked migration in the
-- original production project. Include idempotent definitions so a new
-- project receives the same schema.
create table if not exists public.certification_types (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  description text,
  issuing_organization text,
  expiration_required boolean not null default false,
  default_valid_days integer,
  default_due_soon_days integer not null default 30,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create table if not exists public.department_certification_requirements (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  certification_type_id uuid not null references public.certification_types(id) on delete cascade,
  is_required boolean not null default true,
  valid_days integer,
  due_soon_days integer,
  is_active boolean not null default true,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, certification_type_id)
);

create table if not exists public.training_certifications (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  certification_title text not null,
  issuing_organization text,
  credential_number text,
  issue_date date,
  expiration_date date,
  reminder_days integer[] not null default array[180,90,60,30,14,7,0],
  notes text,
  document_url text,
  is_active boolean not null default true,
  created_by_user_id uuid references auth.users(id),
  updated_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_certifications_title_not_blank check (length(trim(certification_title)) > 0),
  constraint training_certifications_expiration_after_issue check (
    expiration_date is null or issue_date is null or expiration_date >= issue_date
  )
);

alter table public.training_certifications
  add column if not exists certification_type_id uuid
    references public.certification_types(id) on delete set null;

create index if not exists training_certifications_department_idx
  on public.training_certifications(department_id, is_active, expiration_date);
create index if not exists training_certifications_user_idx
  on public.training_certifications(department_id, user_id, is_active);

alter table public.training_certifications enable row level security;
alter table public.certification_types enable row level security;
alter table public.department_certification_requirements enable row level security;

create policy "department members can view certification types"
  on public.certification_types for select to authenticated
  using (public.is_department_member(department_id));

create policy "training managers can manage certification types"
  on public.certification_types for all to authenticated
  using (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view certification requirements"
  on public.department_certification_requirements for select to authenticated
  using (public.is_department_member(department_id));

create policy "training managers can manage certification requirements"
  on public.department_certification_requirements for all to authenticated
  using (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "department members can view training certifications"
  on public.training_certifications for select
  using (public.is_department_member(department_id));

create policy "training managers can insert certifications"
  on public.training_certifications for insert
  with check (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "training managers can update certifications"
  on public.training_certifications for update
  using (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  )
  with check (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

create policy "training managers can delete certifications"
  on public.training_certifications for delete
  using (
    public.has_department_permission(department_id, 'manage_qualifications')
    or public.has_department_permission(department_id, 'administer_department')
  );

grant select, insert, update, delete on public.certification_types to authenticated;
grant select, insert, update, delete on public.department_certification_requirements to authenticated;
grant select, insert, update, delete on public.training_certifications to authenticated;
