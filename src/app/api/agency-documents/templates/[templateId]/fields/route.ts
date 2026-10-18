import { NextResponse } from "next/server";
import { getDocumentField } from "@/lib/agency-documents/field-registry";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ templateId: string }> };
type FieldInput = { id?: string; pageNumber: number; fieldType: "tracepoint_data" | "manual" | "static_text" | "generated_date"; canonicalKey?: string; label?: string; placeholder?: string; staticText?: string; required?: boolean; geometry: { x: number; y: number; width: number; height: number }; formatting?: Record<string, unknown> };
function invalid(field: FieldInput) { const g = field.geometry; return !Number.isInteger(field.pageNumber) || field.pageNumber < 1 || !g || [g.x, g.y, g.width, g.height].some((n) => typeof n !== "number" || !Number.isFinite(n)) || g.width <= 0 || g.height <= 0 || g.x < 0 || g.y < 0 || g.x + g.width > 1 || g.y + g.height > 1 || (field.fieldType === "tracepoint_data" && !getDocumentField(field.canonicalKey ?? "")) || (field.fieldType === "manual" && !field.label?.trim()) || (field.fieldType === "static_text" && !field.staticText?.trim()); }

export async function PUT(request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["manage_document_templates"])) return permissionDeniedResponse("Template-management permission is required.");
  const { templateId } = await route.params; const body = await request.json().catch(() => ({})) as { fields?: FieldInput[] };
  if (!Array.isArray(body.fields) || body.fields.some(invalid)) return NextResponse.json({ error: "One or more template fields are invalid." }, { status: 400 });
  const template = await access.context.admin.from("document_templates").select("current_version").eq("id", templateId).eq("department_id", access.context.departmentId).maybeSingle();
  if (template.error) return NextResponse.json({ error: template.error.message }, { status: 500 }); if (!template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const version = await access.context.admin.from("document_template_versions").select("id").eq("template_id", templateId).eq("department_id", access.context.departmentId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: version.error.message }, { status: 500 });
  // Save atomically from the user's point of view: write the new set first (fresh ids, so a client can never
  // address another record), then remove the previous set. On failure the previous fields remain.
  const previous = await access.context.admin.from("document_template_fields").select("id").eq("department_id", access.context.departmentId).eq("template_version_id", version.data.id);
  if (previous.error) return NextResponse.json({ error: "Template fields could not be saved." }, { status: 500 });
  const rows = body.fields.map((field) => ({ id: crypto.randomUUID(), department_id: access.context.departmentId, template_version_id: version.data.id, page_number: field.pageNumber, field_type: field.fieldType, canonical_key: field.fieldType === "tracepoint_data" ? field.canonicalKey || null : null, label: field.label?.trim() || null, placeholder: field.placeholder || null, static_text: field.fieldType === "static_text" ? field.staticText?.trim() || null : null, is_required: Boolean(field.required), geometry: field.geometry, formatting: field.formatting ?? {} }));
  if (rows.length) {
    const saved = await access.context.admin.from("document_template_fields").insert(rows);
    if (saved.error) return NextResponse.json({ error: "Template fields could not be saved. Your previous fields were kept." }, { status: 500 });
  }
  const oldIds = (previous.data ?? []).map((row: { id: string }) => row.id);
  if (oldIds.length) {
    const deleted = await access.context.admin.from("document_template_fields").delete().eq("department_id", access.context.departmentId).in("id", oldIds);
    if (deleted.error) {
      if (rows.length) await access.context.admin.from("document_template_fields").delete().eq("department_id", access.context.departmentId).in("id", rows.map((row) => row.id));
      return NextResponse.json({ error: "Template fields could not be saved. Your previous fields were kept." }, { status: 500 });
    }
  }
  await access.context.admin.from("document_templates").update({ updated_at: new Date().toISOString(), updated_by_user_id: access.context.userId }).eq("id", templateId).eq("department_id", access.context.departmentId);
  await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "document_template_edited", entity_type: "document_template", entity_id: templateId, summary: "Updated document template fields.", new_value: { field_count: body.fields.length } });
  return NextResponse.json({ ok: true });
}
