import { NextRequest, NextResponse } from "next/server";

import { vehicleDocumentMetadata } from "@/lib/fleet/vehicle-documents";
import { auditFleet, canManageFleet } from "@/lib/tracepoint/fleet-server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ vehicleId: string; documentId: string }> };

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId, documentId } = await routeContext.params;
  const { data: rules } = await context.admin.from("fleet_rules").select("fleet_manager_role_codes").eq("department_id", context.departmentId).maybeSingle();
  if (!canManageFleet(context, rules)) return NextResponse.json({ error: "Fleet Manager access is required." }, { status: 403 });
  const existing = await context.admin.from("attachments").select("id,file_name,attachment_type,description,expiration_date")
    .eq("id", documentId).eq("department_id", context.departmentId).eq("entity_type", "fleet_vehicle_document").eq("entity_id", vehicleId).is("archived_at", null).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ error: "Vehicle document was not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  let metadata;
  try {
    metadata = vehicleDocumentMetadata({ fileName: existing.data.file_name, title: body.title ?? existing.data.description, documentType: body.documentType ?? existing.data.attachment_type, expirationDate: body.expirationDate ?? existing.data.expiration_date });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document metadata is invalid." }, { status: 400 });
  }
  const updated = await context.admin.from("attachments").update({ description: metadata.title, attachment_type: metadata.documentType, expiration_date: metadata.expirationDate })
    .eq("id", documentId).eq("department_id", context.departmentId).select("id,attachment_type,file_name,mime_type,file_size,description,expiration_date,uploaded_by_user_id,uploaded_at").single();
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });
  if (metadata.documentType === "Registration" && metadata.expirationDate) {
    const registration = await context.admin.from("fleet_vehicles").update({ registration_expiration_date: metadata.expirationDate, updated_at: new Date().toISOString(), updated_by_user_id: context.userId }).eq("department_id", context.departmentId).eq("id", vehicleId);
    if (registration.error) return NextResponse.json({ error: registration.error.message }, { status: 500 });
  }
  await auditFleet(context, "fleet_vehicle_document_updated", "fleet_vehicle", vehicleId, { attachment_id: documentId, document_type: metadata.documentType, title: metadata.title, expiration_date: metadata.expirationDate });
  return NextResponse.json({ document: updated.data });
}
