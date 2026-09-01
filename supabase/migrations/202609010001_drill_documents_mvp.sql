-- Drill Library documents remain linked to the pilot workspace record key until
-- Range Days moves from pilot_range_workspaces JSON to public.drill_templates.
create table public.drill_documents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  drill_template_id text not null check (length(btrim(drill_template_id)) between 1 and 255),
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 15728640),
  uploaded_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (department_id, uploaded_by_user_id)
    references public.department_memberships(department_id, user_id)
    on delete restrict,
  unique (id, department_id)
);

create index drill_documents_department_template_idx
  on public.drill_documents(department_id, drill_template_id, created_at desc);

alter table public.drill_documents enable row level security;

create policy drill_documents_select_members
on public.drill_documents for select to authenticated
using (public.is_active_department_member(department_id, auth.uid()));

create policy drill_documents_insert_range_administrators
on public.drill_documents for insert to authenticated
with check (
  uploaded_by_user_id = auth.uid()
  and public.has_department_permission(department_id, 'manage_range_days')
);

create policy drill_documents_delete_range_administrators
on public.drill_documents for delete to authenticated
using (public.has_department_permission(department_id, 'manage_range_days'));

-- The private bucket is idempotently defined here because older environments
-- may have created it manually. Application routes still enforce tenant scope.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tracepoint-attachments',
  'tracepoint-attachments',
  false,
  26214400,
  null
)
on conflict (id) do update set
  public = false,
  file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), 26214400);

grant select, insert, delete on public.drill_documents to authenticated;

comment on table public.drill_documents is
  'Tenant-scoped metadata for documents attached to Drill Library workspace records.';
comment on column public.drill_documents.storage_path is
  'Provider-neutral object key; maps to the private TracePoint S3 attachment bucket.';
