begin;

-- Migrations 038–040 established tenant-scoped read access but omitted the
-- authenticated DML privileges and RLS policies used by the reviewed template
-- builder routes. Keep writes limited to template managers and generation
-- records limited to document generators; do not widen runtime authority.
grant insert, update, delete on public.document_templates, public.document_template_versions,
  public.document_template_fields, public.document_template_analysis_proposals,
  public.document_template_structured_bindings to authenticated;
grant insert on public.generated_documents to authenticated;

create policy document_templates_manage on public.document_templates for all to authenticated
  using (public.has_department_permission(department_id, 'manage_document_templates'))
  with check (public.has_department_permission(department_id, 'manage_document_templates'));
create policy document_template_versions_manage on public.document_template_versions for all to authenticated
  using (public.has_department_permission(department_id, 'manage_document_templates'))
  with check (public.has_department_permission(department_id, 'manage_document_templates'));
create policy document_template_fields_manage on public.document_template_fields for all to authenticated
  using (public.has_department_permission(department_id, 'manage_document_templates'))
  with check (public.has_department_permission(department_id, 'manage_document_templates'));
create policy document_template_analysis_proposals_manage on public.document_template_analysis_proposals for all to authenticated
  using (public.has_department_permission(department_id, 'manage_document_templates'))
  with check (public.has_department_permission(department_id, 'manage_document_templates'));
create policy document_template_structured_bindings_manage on public.document_template_structured_bindings for all to authenticated
  using (public.has_department_permission(department_id, 'manage_document_templates'))
  with check (public.has_department_permission(department_id, 'manage_document_templates'));
create policy generated_documents_create on public.generated_documents for insert to authenticated
  with check (public.has_department_permission(department_id, 'generate_agency_documents')
    or public.has_department_permission(department_id, 'manage_document_templates'));

commit;
