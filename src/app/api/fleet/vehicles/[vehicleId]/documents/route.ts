import { NextRequest, NextResponse } from "next/server";
import { createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { auditFleet, canManageFleet, text } from "@/lib/tracepoint/fleet-server";
import { vehicleDocumentMetadata } from "@/lib/fleet/vehicle-documents";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { data: rules } = await context.admin.from("fleet_rules").select("fleet_manager_role_codes").eq("department_id", context.departmentId).maybeSingle();
  if (!canManageFleet(context, rules)) return NextResponse.json({ error: "Fleet Manager access is required." }, { status: 403 });
  const { vehicleId } = await params;
  const vehicle = await context.admin.from("fleet_vehicles").select("id").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
  if (vehicle.error || !vehicle.data) return NextResponse.json({ error: vehicle.error?.message ?? "Vehicle was not found." }, { status: vehicle.error ? 500 : 404 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF or image to upload." }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Only PDF, JPG, PNG, and WebP files are allowed." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Files may not exceed 15 MB." }, { status: 400 });
  let metadata;
  try {
    metadata = vehicleDocumentMetadata({ fileName: file.name, title: form.get("title"), documentType: form.get("documentType"), expirationDate: form.get("expirationDate") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document metadata is invalid." }, { status: 400 });
  }
  const replaceAttachmentId = text(form.get("replaceAttachmentId"), 100);
  if (replaceAttachmentId) {
    const replaced = await context.admin.from("attachments").select("id,file_name")
      .eq("id", replaceAttachmentId).eq("department_id", context.departmentId).eq("entity_type", "fleet_vehicle_document").eq("entity_id", vehicleId).is("archived_at", null).maybeSingle();
    if (replaced.error) return NextResponse.json({ error: replaced.error.message }, { status: 500 });
    if (!replaced.data) return NextResponse.json({ error: "The document selected for replacement was not found." }, { status: 404 });
  }
  const attachmentId = crypto.randomUUID();
  const objectStore = createObjectStore(context.admin, context.departmentId);
  const upload = await objectStore.uploadFleetDocument({ departmentId: context.departmentId, recordId: vehicleId, objectId: attachmentId, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
  const inserted = await context.admin.from("attachments").insert({ id: attachmentId, department_id: context.departmentId, entity_type: "fleet_vehicle_document", entity_id: vehicleId, attachment_type: metadata.documentType, file_name: file.name, storage_path: upload.path, mime_type: file.type, file_size: file.size, description: metadata.title, expiration_date: metadata.expirationDate, uploaded_by_user_id: context.userId }).select("id,attachment_type,file_name,mime_type,file_size,description,expiration_date,uploaded_by_user_id,uploaded_at").single();
  if (inserted.error) { await objectStore.removeAttachment(upload.path); return NextResponse.json({ error: inserted.error.message }, { status: 500 }); }
  if (replaceAttachmentId) {
    const archived = await context.admin.from("attachments").update({ archived_at: new Date().toISOString(), archived_by_user_id: context.userId, archive_reason: "Replaced by a newer vehicle document" })
      .eq("id", replaceAttachmentId).eq("department_id", context.departmentId).eq("entity_type", "fleet_vehicle_document").eq("entity_id", vehicleId).is("archived_at", null);
    if (archived.error) return NextResponse.json({ error: archived.error.message }, { status: 500 });
  }
  if (metadata.documentType === "Registration" && metadata.expirationDate) {
    const registration = await context.admin.from("fleet_vehicles").update({ registration_expiration_date: metadata.expirationDate, updated_at: new Date().toISOString(), updated_by_user_id: context.userId }).eq("department_id", context.departmentId).eq("id", vehicleId);
    if (registration.error) return NextResponse.json({ error: registration.error.message }, { status: 500 });
  }
  await auditFleet(context, replaceAttachmentId ? "fleet_vehicle_document_replaced" : "fleet_vehicle_document_uploaded", "fleet_vehicle", vehicleId, { attachment_id: attachmentId, replaced_attachment_id: replaceAttachmentId || null, document_type: metadata.documentType, title: metadata.title, expiration_date: metadata.expirationDate, file_name: file.name, file_size: file.size });
  return NextResponse.json({ document: inserted.data }, { status: 201 });
}
