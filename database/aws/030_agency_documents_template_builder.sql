begin;

insert into public.permissions(code, display_name, description) values
  ('view_agency_documents', 'View Agency Documents', 'View Agency Documents and published templates.'),
  ('generate_agency_documents', 'Generate Agency Documents', 'Generate documents from published templates.'),
  ('manage_document_templates', 'Manage Document Templates', 'Create, edit, duplicate, publish, unpublish, and archive Agency Document templates.')
on conflict (code) do update set display_name = excluded.display_name, description = excluded.description;

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  category text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version integer not null default 1 check (current_version > 0),
  source_filename text not null,
  source_storage_path text not null,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, department_id)
);
create index if not exists document_templates_department_idx on public.document_templates(department_id, status, updated_at desc);

create table if not exists public.document_template_versions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  template_id uuid not null references public.document_templates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  source_filename text not null,
  source_storage_path text not null,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_id, version_number), unique (id, department_id)
);
create index if not exists document_template_versions_tenant_idx on public.document_template_versions(department_id, template_id, version_number desc);

create table if not exists public.document_template_fields (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  template_version_id uuid not null references public.document_template_versions(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  field_type text not null check (field_type in ('tracepoint_data', 'manual', 'static_text', 'generated_date')),
  canonical_key text,
  label text,
  placeholder text,
  static_text text,
  is_required boolean not null default false,
  geometry jsonb not null check (jsonb_typeof(geometry) = 'object'),
  formatting jsonb not null default '{}'::jsonb check (jsonb_typeof(formatting) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((field_type = 'tracepoint_data' and canonical_key is not null) or (field_type = 'manual' and label is not null) or (field_type = 'static_text' and static_text is not null) or field_type = 'generated_date'),
  unique (id, department_id)
);
create index if not exists document_template_fields_version_idx on public.document_template_fields(department_id, template_version_id, page_number);

create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  template_id uuid not null references public.document_templates(id) on delete restrict,
  template_version_id uuid not null references public.document_template_versions(id) on delete restrict,
  generated_by_user_id uuid references public.profiles(id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  storage_path text,
  created_at timestamptz not null default now(),
  unique (id, department_id)
);

alter table public.document_templates enable row level security;
alter table public.document_template_versions enable row level security;
alter table public.document_template_fields enable row level security;
alter table public.generated_documents enable row level security;
create policy document_templates_tenant_read on public.document_templates for select to authenticated using (public.has_department_permission(department_id, 'view_agency_documents') or public.has_department_permission(department_id, 'generate_agency_documents') or public.has_department_permission(department_id, 'manage_document_templates'));
create policy document_template_versions_tenant_read on public.document_template_versions for select to authenticated using (public.has_department_permission(department_id, 'view_agency_documents') or public.has_department_permission(department_id, 'generate_agency_documents') or public.has_department_permission(department_id, 'manage_document_templates'));
create policy document_template_fields_tenant_read on public.document_template_fields for select to authenticated using (public.has_department_permission(department_id, 'view_agency_documents') or public.has_department_permission(department_id, 'generate_agency_documents') or public.has_department_permission(department_id, 'manage_document_templates'));
create policy generated_documents_tenant_read on public.generated_documents for select to authenticated using (public.has_department_permission(department_id, 'generate_agency_documents') or public.has_department_permission(department_id, 'manage_document_templates'));
grant select on public.document_templates, public.document_template_versions, public.document_template_fields, public.generated_documents to authenticated;

commit;
