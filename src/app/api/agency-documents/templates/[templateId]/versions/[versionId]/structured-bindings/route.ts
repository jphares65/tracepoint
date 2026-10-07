import { NextResponse } from "next/server";
import { normalizeStructuredBindingInput } from "@/lib/agency-documents/structured-binding-http";
import { StructuredBindingDuplicateError, StructuredBindingRepository, StructuredBindingRepositoryError, type StructuredBindingSupabaseClient } from "@/lib/agency-documents/structured-binding-repository";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ templateId: string; versionId: string }> };
const VIEW = ["view_agency_documents", "generate_agency_documents", "manage_document_templates"] as const;
const MANAGE = ["manage_document_templates"] as const;
function response(error: string, status: number) { return NextResponse.json({ error }, { status }); }
async function ownedVersion(admin: { from(table: string): { select(fields: string): { eq(column: string, value: string | number): { eq(column: string, value: string | number): { maybeSingle(): Promise<{ data: { id: string; current_version?: number; version_number?: number } | null; error: { message: string } | null }> } } } } }, departmentId: string, templateId: string, versionId: string, editable: boolean) {
  const template = await admin.from("document_templates").select("id,current_version").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error) return { status: 500 as const }; if (!template.data) return { status: 404 as const };
  const version = await admin.from("document_template_versions").select("id,version_number").eq("id", versionId).eq("template_id", templateId).maybeSingle();
  if (version.error) return { status: 500 as const }; if (!version.data) return { status: 404 as const };
  if (editable && version.data.version_number !== template.data.current_version) return { status: 404 as const };
  return { status: 200 as const };
}
function repository(admin: StructuredBindingSupabaseClient, departmentId: string) { return new StructuredBindingRepository(admin, departmentId); }

export async function GET(_request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, VIEW)) return permissionDeniedResponse("Agency Documents access is required.");
  const { templateId, versionId } = await route.params;
  const ownership = await ownedVersion(access.context.admin, access.context.departmentId, templateId, versionId, false);
  if (ownership.status !== 200) return response(ownership.status === 404 ? "Template version not found." : "Template could not be read.", ownership.status);
  try { return NextResponse.json({ bindings: await repository(access.context.admin, access.context.departmentId).listByTemplateVersion(versionId) }); }
  catch { return response("Structured bindings could not be loaded.", 500); }
}

export async function POST(request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, MANAGE)) return permissionDeniedResponse("Template-management permission is required.");
  const { templateId, versionId } = await route.params;
  const ownership = await ownedVersion(access.context.admin, access.context.departmentId, templateId, versionId, true);
  if (ownership.status !== 200) return response(ownership.status === 404 ? "Template version not found." : "Template could not be read.", ownership.status);
  try {
    const binding = await repository(access.context.admin, access.context.departmentId).create({ ...normalizeStructuredBindingInput(await request.json().catch(() => null)), templateId, templateVersionId: versionId, actorUserId: access.context.userId });
    await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "document_template_structured_binding_created", entity_type: "document_template_structured_binding", entity_id: binding.id, summary: "Created document template structured binding.", new_value: { template_id: templateId, template_version_id: versionId, section_key: binding.sectionKey } });
    return NextResponse.json({ binding }, { status: 201 });
  } catch (error) {
    if (error instanceof StructuredBindingDuplicateError) return response(error.message, 409);
    if (error instanceof StructuredBindingRepositoryError) return response("Structured binding could not be saved.", 500);
    return response("Invalid structured binding configuration.", 400);
  }
}
