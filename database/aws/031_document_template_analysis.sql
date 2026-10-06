begin;
alter table public.document_templates add column if not exists analysis_status text not null default 'not_analyzed' check (analysis_status in ('not_analyzed','analyzing','analyzed','failed'));
alter table public.document_templates add column if not exists analysis_version text;
create table if not exists public.document_template_analysis_proposals (
 id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete cascade, template_id uuid not null references public.document_templates(id) on delete cascade,
 proposal jsonb not null check (jsonb_typeof(proposal)='object'), status text not null default 'proposed' check (status in ('proposed','accepted','modified','rejected')), created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by_user_id uuid references public.profiles(id) on delete set null
);
create index if not exists document_template_analysis_proposals_tenant_idx on public.document_template_analysis_proposals(department_id,template_id,status);
alter table public.document_template_analysis_proposals enable row level security;
create policy document_template_analysis_proposals_read on public.document_template_analysis_proposals for select to authenticated using (public.has_department_permission(department_id,'manage_document_templates'));
grant select on public.document_template_analysis_proposals to authenticated;
commit;
