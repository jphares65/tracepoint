import { NextResponse } from "next/server";
import { publishBlockers } from "@/lib/agency-documents/proposal-review";
import { structuredPublishBlockers } from "@/lib/agency-documents/field-persistence";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ templateId: string }> };
const VIEW = ["view_agency_documents", "generate_agency_documents", "manage_document_templates"] as const;
const MANAGE = ["manage_document_templates"] as const;
function response(error: string, status = 400) { return NextResponse.json({ error }, { status }); }

export async function GET(_request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, VIEW)) return permissionDeniedResponse("Agency Documents access is required.");
  const { templateId } = await route.params;
  const template = await access.context.admin.from("document_templates").select("*").eq("id", templateId).eq("department_id", access.context.departmentId).maybeSingle();
  if (template.error) return response(template.error.message, 500); if (!template.data) return response("Template not found.", 404);
  const version = await access.context.admin.from("document_template_versions").select("id,version_number,source_storage_path").eq("template_id", templateId).eq("department_id", access.context.departmentId).eq("version_number", template.data.current_version).maybeSingle();
  if (version.error || !version.data) return response(version.error?.message ?? "Template version not found.", 500);
  const fields = await access.context.admin.from("document_template_fields").select("*").eq("template_version_id", version.data.id).eq("department_id", access.context.departmentId).order("created_at");
  if (fields.error) return response(fields.error.message, 500);
  return NextResponse.json({ template: template.data, version: version.data, fields: fields.data ?? [], canManage: hasAnyServerPermission(access.context, MANAGE) });
}

export async function PATCH(request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, MANAGE)) return permissionDeniedResponse("Template-management permission is required.");
  const { templateId } = await route.params; const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const existing = await access.context.admin.from("document_templates").select("id,name,status,current_version,source_filename,source_storage_path,description,category").eq("id", templateId).eq("department_id", access.context.departmentId).maybeSingle();
  if (existing.error) return response(existing.error.message, 500); if (!existing.data) return response("Template not found.", 404);
  if (body.action === "duplicate") {
    const duplicate = await access.context.admin.from("document_templates").insert({ id: crypto.randomUUID(), department_id: access.context.departmentId, name: `${existing.data.name} copy`, description: existing.data.description, category: existing.data.category, status: "draft", current_version: 1, source_filename: existing.data.source_filename, source_storage_path: existing.data.source_storage_path, created_by_user_id: access.context.userId, updated_by_user_id: access.context.userId }).select("id").single();
    if (duplicate.error) return response(duplicate.error.message, 500);
    const oldVersion = await access.context.admin.from("document_template_versions").select("*").eq("template_id", templateId).eq("department_id", access.context.departmentId).eq("version_number", existing.data.current_version).single();
    if (oldVersion.error) return response(oldVersion.error.message, 500);
    const newVersion = await access.context.admin.from("document_template_versions").insert({ department_id: access.context.departmentId, template_id: duplicate.data.id, version_number: 1, source_filename: oldVersion.data.source_filename, source_storage_path: oldVersion.data.source_storage_path, created_by_user_id: access.context.userId }).select("id").single();
    if (newVersion.error) return response(newVersion.error.message, 500);
    const oldFields = await access.context.admin.from("document_template_fields").select("*").eq("template_version_id", oldVersion.data.id).eq("department_id", access.context.departmentId);
    if (oldFields.error) return response(oldFields.error.message, 500);
    if (oldFields.data?.length) {
      const copiedFields = await access.context.admin.from("document_template_fields").insert(oldFields.data.map((stored: Record<string, unknown>) => { const field = { ...stored }; delete field.id; delete field.created_at; delete field.updated_at; return { ...field, id: crypto.randomUUID(), department_id: access.context.departmentId, template_version_id: newVersion.data.id }; }));
      if (copiedFields.error) return response(copiedFields.error.message, 500);
    }
    const bindings = await access.context.admin.from("document_template_structured_bindings").select("*").eq("template_version_id", oldVersion.data.id).eq("department_id", access.context.departmentId);
    if (bindings.error) return response(bindings.error.message, 500);
    if (bindings.data?.length) {
      const copiedBindings = await access.context.admin.from("document_template_structured_bindings").insert(bindings.data.map((stored: Record<string, unknown>) => { const binding = { ...stored }; delete binding.id; delete binding.created_at; delete binding.updated_at; return { ...binding, id: crypto.randomUUID(), department_id: access.context.departmentId, template_id: duplicate.data.id, template_version_id: newVersion.data.id, created_by_user_id: access.context.userId, updated_by_user_id: access.context.userId }; }));
      if (copiedBindings.error) return response(copiedBindings.error.message, 500);
    }
    await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "document_template_duplicated", entity_type: "document_template", entity_id: duplicate.data.id, summary: `Duplicated document template ${existing.data.name}.`, new_value: { source_template_id: templateId } });
    return NextResponse.json({ id: duplicate.data.id });
  }
  const status = body.status; if (status !== "draft" && status !== "published" && status !== "archived") return response("A valid template status is required.");
  if (status === "published") {
    // A template can only be published once every field is confirmed and complete.
    const current = await access.context.admin.from("document_template_versions").select("id").eq("template_id", templateId).eq("department_id", access.context.departmentId).eq("version_number", existing.data.current_version).single();
    if (current.error) return response("The template version could not be loaded.", 500);
    const fieldRows = await access.context.admin.from("document_template_fields").select("id,field_type,canonical_key,label,static_text,formatting").eq("template_version_id", current.data.id).eq("department_id", access.context.departmentId);
    if (fieldRows.error) return response("Template fields could not be checked.", 500);
    // Repeating sections found on the form must be bound or explicitly dismissed.
    const pending = await access.context.admin.from("document_template_analysis_proposals").select("id,status,proposal").eq("template_id", templateId).eq("department_id", access.context.departmentId).in("status", ["proposed", "modified"]);
    const bindings = await access.context.admin.from("document_template_structured_bindings").select("section_key").eq("template_version_id", current.data.id).eq("department_id", access.context.departmentId);
    if (pending.error || bindings.error) return response("Template sections could not be checked.", 500);
    const blockers = [...publishBlockers(fieldRows.data ?? []), ...structuredPublishBlockers(pending.data ?? [], (bindings.data ?? []).map((row: { section_key: string }) => row.section_key))];
    if (blockers.length) return NextResponse.json({ error: "Review the flagged fields before publishing.", blockers }, { status: 409 });
  }
  const updated = await access.context.admin.from("document_templates").update({ status, updated_by_user_id: access.context.userId, updated_at: new Date().toISOString() }).eq("id", templateId).eq("department_id", access.context.departmentId);
  if (updated.error) return response(updated.error.message, 500);
  await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: `document_template_${status === "published" ? "published" : status === "draft" ? "unpublished" : "archived"}`, entity_type: "document_template", entity_id: templateId, summary: `${status === "published" ? "Published" : status === "draft" ? "Unpublished" : "Archived"} document template ${existing.data.name}.` });
  return NextResponse.json({ ok: true });
}
