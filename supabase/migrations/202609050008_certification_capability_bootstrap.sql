-- Existing inspection handlers require this policy table. No agency rule is seeded.
create unique index if not exists certification_types_department_id_id_unique
 on public.certification_types(department_id,id);
create table public.department_certification_capabilities (
 id uuid primary key default gen_random_uuid(),
 department_id uuid not null references public.departments(id) on delete cascade,
 capability_code text not null check(capability_code in ('perform_firearm_inspections')),
 certification_type_id uuid not null,
 is_active boolean not null default true,
 notes text,
 updated_by_user_id uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(department_id,capability_code),
 foreign key(department_id,certification_type_id) references public.certification_types(department_id,id) on delete cascade
);
alter table public.department_certification_capabilities enable row level security;
revoke all on public.department_certification_capabilities from anon,authenticated;
grant select on public.department_certification_capabilities to authenticated;
create policy certification_capability_member_read on public.department_certification_capabilities
 for select to authenticated using(public.is_department_member(department_id));
grant select,insert,update,delete on public.department_certification_capabilities to service_role;
create trigger certification_capabilities_accountability_audit after insert or update or delete
 on public.department_certification_capabilities for each row execute function public.write_audit_event();
notify pgrst, 'reload schema';
