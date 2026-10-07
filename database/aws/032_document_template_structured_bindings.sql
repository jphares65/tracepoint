begin;

create table if not exists public.document_template_structured_bindings (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  template_id uuid not null references public.document_templates(id) on delete cascade,
  template_version_id uuid not null references public.document_template_versions(id) on delete cascade,
  section_key text not null check (btrim(section_key) <> ''),
  source_type text not null check (source_type in ('qualification_history')),
  fill_mode text not null check (fill_mode in ('rows','columns','sequential_cells')),
  ordering text not null check (ordering in ('date_asc','date_desc')),
  max_rows integer not null check (max_rows > 0),
  overflow_behavior text not null check (overflow_behavior in ('truncate_with_warning','require_review','error')),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  column_mappings jsonb not null check (jsonb_typeof(column_mappings) = 'array'),
  formatting jsonb not null default '{}'::jsonb check (jsonb_typeof(formatting) = 'object'),
  target_cells jsonb not null check (jsonb_typeof(target_cells) = 'array'),
  created_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, section_key),
  unique (id, department_id)
);
create index if not exists document_template_structured_bindings_version_idx on public.document_template_structured_bindings(department_id, template_version_id);

alter table public.document_template_structured_bindings enable row level security;
create policy document_template_structured_bindings_read on public.document_template_structured_bindings for select to authenticated using (public.has_department_permission(department_id, 'view_agency_documents') or public.has_department_permission(department_id, 'generate_agency_documents') or public.has_department_permission(department_id, 'manage_document_templates'));
grant select on public.document_template_structured_bindings to authenticated;

commit;
