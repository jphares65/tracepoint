import { NextResponse } from "next/server";
import { getDocumentField } from "@/lib/agency-documents/field-registry";
import { planFieldSave } from "@/lib/agency-documents/field-persistence";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { revisionLockedError } from "@/lib/agency-documents/template-revisions";

type Context = { params: Promise<{ templateId: string }> };
type FieldInput = { id?: string; pageNumber: number; fieldType: "tracepoint_data" | "manual" | "static_text" | "generated_date"; canonicalKey?: string; label?: string; placeholder?: string; staticText?: string; required?: boolean; geometry: { x: number; y: number; width: number; height: number }; formatting?: Record<string, unknown> };
function invalid(field: FieldInput) { const g = field.geometry; return !Number.isInteger(field.pageNumber) || field.pageNumber < 1 || !g || [g.x, g.y, g.width, g.height].some((n) => typeof n !== "number" || !Number.isFinite(n)) || g.width <= 0 || g.height <= 0 || g.x < 0 || g.y < 0 || g.x + g.width > 1 || g.y + g.height > 1 || (field.fieldType === "tracepoint_data" && !getDocumentField(field.canonicalKey ?? "")) || (field.fieldType === "manual" && !field.label?.trim()) || (field.fieldType === "static_text" && !field.staticText?.trim()); }

export async function PUT(request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["manage_document_templates"])) return permissionDeniedResponse("Template-management permission is required.");
  const { templateId } = await route.params; const body = await request.json().catch(() => ({})) as { fields?: FieldInput[] };
  if (!Array.isArray(body.fields) || body.fields.some(invalid)) return NextResponse.json({ error: "One or more template fields are invalid." }, { status: 400 });
  const template = await access.context.admin.from("document_templates").select("current_version,status").eq("id", templateId).eq("department_id", access.context.departmentId).maybeSingle();
  if (template.error) return NextResponse.json({ error: template.error.message }, { status: 500 }); if (!template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  // A published template is in use; changing its fields could change documents generated from it. Unpublish first.
  if (template.data.status === "published") return NextResponse.json({ error: "Unpublish this template before editing its fields." }, { status: 409 });
  // Documents generated from this revision fix its fields; edits need a new revision.
  const locked = await revisionLockedError(access.context.admin, access.context.departmentId, templateId, template.data.current_version);
  if (locked) return NextResponse.json(locked.revisionLocked ? { error: locked.error, revisionLocked: true } : { error: locked.error }, { status: locked.status });
  const version = await access.context.admin.from("document_template_versions").select("id").eq("template_id", templateId).eq("department_id", access.context.departmentId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: version.error.message }, { status: 500 });
  // Field ids are stable: existing fields keep their id (saved decisions and generated-document provenance
  // stay valid); only new fields get a server-generated id. All rows are written in one upsert statement,
  // then fields that were removed in the editor are deleted. On failure the previous fields remain.
  const existing = await access.context.admin.from("document_template_fields").select("id").eq("department_id", access.context.departmentId).eq("template_version_id", version.data.id);
  if (existing.error) return NextResponse.json({ error: "Template fields could not be saved." }, { status: 500 });
  const plan = planFieldSave((existing.data ?? []).map((row: { id: string }) => row.id), body.fields);
  const rows = plan.rows.map((field) => ({ id: field.id, department_id: access.context.departmentId, template_version_id: version.data.id, page_number: field.pageNumber, field_type: field.fieldType, canonical_key: field.fieldType === "tracepoint_data" ? field.canonicalKey || null : null, label: field.label?.trim() || null, placeholder: field.placeholder || null, static_text: field.fieldType === "static_text" ? field.staticText?.trim() || null : null, is_required: Boolean(field.required), geometry: field.geometry, formatting: field.formatting ?? {}, updated_at: new Date().toISOString() }));
  if (rows.length) {
    const saved = await access.context.admin.from("document_template_fields").upsert(rows, { onConflict: "id" });
    if (saved.error) return NextResponse.json({ error: "Template fields could not be saved. Your previous fields were kept." }, { status: 500 });
  }
  if (plan.staleIds.length) {
    const deleted = await access.context.admin.from("document_template_fields").delete().eq("department_id", access.context.departmentId).eq("template_version_id", version.data.id).in("id", plan.staleIds);
    if (deleted.error) return NextResponse.json({ error: "Removed fields could not be deleted. Refresh and try again." }, { status: 500 });
  }
  await access.context.admin.from("document_templates").update({ updated_at: new Date().toISOString(), updated_by_user_id: access.context.userId }).eq("id", templateId).eq("department_id", access.context.departmentId);
  await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "document_template_edited", entity_type: "document_template", entity_id: templateId, summary: "Updated document template fields.", new_value: { field_count: body.fields.length, created: plan.ids.filter((entry) => entry.created).length, removed: plan.staleIds.length } });
  return NextResponse.json({ ok: true, ids: plan.ids });
}
