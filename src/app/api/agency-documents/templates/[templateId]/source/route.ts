import { agencyDocumentsDisabledResponse } from "@/lib/agency-documents/module-access";
import { NextResponse } from "next/server";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
type Context = { params: Promise<{ templateId: string }> };
export async function GET(_request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access); const moduleDisabled = agencyDocumentsDisabledResponse(access.context); if (moduleDisabled) return moduleDisabled;
  if (!hasAnyServerPermission(access.context, ["view_agency_documents", "generate_agency_documents", "manage_document_templates"])) return permissionDeniedResponse("Agency Documents access is required.");
  const { templateId } = await route.params;
  const row = await access.context.admin.from("document_templates").select("source_storage_path").eq("id", templateId).eq("department_id", access.context.departmentId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  const path = attachmentPathFromMetadata(row.data?.source_storage_path ?? "", access.context.departmentId); if (!path) return NextResponse.json({ error: "Template source not found." }, { status: 404 });
  const signed = await createObjectStore(access.context.admin, access.context.departmentId).createAttachmentView(path);
  if (signed.error || !signed.signedUrl) return NextResponse.json({ error: signed.error?.message ?? "Template source could not be opened." }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
}
