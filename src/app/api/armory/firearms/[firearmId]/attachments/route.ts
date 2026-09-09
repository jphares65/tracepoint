import { NextRequest, NextResponse } from "next/server";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createObjectStore } from "@/lib/storage/object-store";
import { createEvidenceReadRepository } from "@/lib/evidence/read-repository";

type RouteContext = { params: Promise<{ firearmId: string }> };
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const VALID_CATEGORIES = new Set(["acquisition", "transfer_disposition", "maintenance_repair", "inspection", "photo", "other"]);

async function verifyFirearm(admin: any, departmentId: string, firearmId: string) {
  return admin.from("firearms").select("id").eq("id", firearmId).eq("department_id", departmentId).maybeSingle();
}

export async function GET(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const { firearmId } = await routeContext.params;
  const { admin, departmentId } = resolved.context;
  const repository = createEvidenceReadRepository(admin, departmentId);
  try {
  const firearm = await repository.getFirearm(departmentId, firearmId);
  if (!firearm) return NextResponse.json({ error: "Firearm not found." }, { status: 404 });
  const attachments = await repository.listFirearmAttachments(departmentId, firearmId);
  return NextResponse.json({ attachments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Attachments could not be loaded." }, { status: 500 }); }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  
  const featureError = requireServerFeature(
    context,
    "firearms",
    "Firearms",
  );

  if (featureError) {
    return featureError;
  }
if (!hasAnyServerPermission(context, ["manage_firearms"])) {
    return permissionDeniedResponse("Firearm-management permission is required to upload documents.");
  }
  const { firearmId } = await routeContext.params;
  const firearm = await verifyFirearm(context.admin, context.departmentId, firearmId);
  if (firearm.error) return NextResponse.json({ error: firearm.error.message }, { status: 500 });
  if (!firearm.data) return NextResponse.json({ error: "Firearm not found." }, { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  const category = String(form.get("attachmentType") ?? "other").trim();
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (!VALID_CATEGORIES.has(category)) return NextResponse.json({ error: "Invalid document type." }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Only PDF, JPG, PNG, and WebP files are allowed." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Files may not exceed 15 MB." }, { status: 400 });

  const attachmentId = crypto.randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const objectStore = createObjectStore(context.admin, context.departmentId);
  const upload = await objectStore.uploadFirearmAttachment({
    departmentId: context.departmentId,
    recordId: firearmId,
    objectId: attachmentId,
    fileName: file.name,
    bytes,
    contentType: file.type,
  });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
  const storagePath = upload.path;

  const row = {
    id: attachmentId, department_id: context.departmentId, entity_type: "firearm", entity_id: firearmId,
    attachment_type: category, file_name: file.name, storage_path: storagePath, mime_type: file.type,
    file_size: file.size, description: description || null, uploaded_by_user_id: context.userId,
  };
  const inserted = await context.admin.from("attachments").insert(row).select("id,attachment_type,file_name,mime_type,file_size,description,uploaded_by_user_id,uploaded_at").single();
  if (inserted.error) {
    await objectStore.removeAttachment(storagePath);
    return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  }
  await context.admin.from("audit_events").insert({
    department_id: context.departmentId, actor_user_id: context.userId, action: "attachment_uploaded",
    entity_type: "firearm", entity_id: firearmId, summary: `Uploaded ${file.name} to firearm record.`,
    new_value: { attachment_id: attachmentId, attachment_type: category, file_name: file.name, file_size: file.size },
  });
  return NextResponse.json({ attachment: inserted.data }, { status: 201 });
}

