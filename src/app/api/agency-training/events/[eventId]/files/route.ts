import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createObjectStore } from "@/lib/storage/object-store";
import { createAgencyTrainingReadRepository } from "@/lib/agency-training/read-repository";

type RouteContext = { params: Promise<{ eventId: string }> };
const MANAGE = ["manage_training", "manage_certifications", "manage_range_days"] as const;

async function eventExists(admin: any, departmentId: string, eventId: string) {
  return admin.from("agency_training_events").select("id,status").eq("department_id", departmentId).eq("id", eventId).maybeSingle();
}

export async function GET(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { eventId } = await routeContext.params;
  try {
  const data = await createAgencyTrainingReadRepository(context.admin, context.departmentId).getFiles({ departmentId: context.departmentId, eventId });
  if (!data) return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  const names = new Map(data.profiles.map((row: any) => [String(row.id), row.full_name]));
  return NextResponse.json({
    status: data.event.status,
    files: data.files,
    certificates: data.certificates.map((row: any) => ({ ...row, fullName: names.get(String(row.user_id)) ?? "Department Member" })),
    canManage: hasAnyServerPermission(context, MANAGE),
  }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Training files could not be loaded." }, { status: 500 }); }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  if (!hasAnyServerPermission(context, MANAGE)) return permissionDeniedResponse("Training-management permission is required to attach files.");
  const { eventId } = await routeContext.params;
  const event = await eventExists(context.admin, context.departmentId, eventId);
  if (event.error) return NextResponse.json({ error: event.error.message }, { status: 500 });
  if (!event.data) return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  if (event.data.status === "completed") return NextResponse.json({ error: "Reopen completed training before changing its files." }, { status: 409 });

  const form = await request.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "supporting_document");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Training files may not exceed 25 MB." }, { status: 400 });
  const attachmentType = kind === "lesson_plan" ? "training_lesson_plan" : "training_supporting_document";
  const attachmentId = crypto.randomUUID();
  const objectStore = createObjectStore(context.admin);
  const upload = await objectStore.uploadTrainingFile({
    departmentId: context.departmentId,
    recordId: eventId,
    objectId: attachmentId,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type || "application/octet-stream",
  });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
  const storagePath = upload.path;
  const inserted = await context.admin.from("attachments").insert({
    id: attachmentId, department_id: context.departmentId,
    entity_type: "agency_training_event", entity_id: eventId,
    attachment_type: attachmentType, file_name: file.name,
    mime_type: file.type || "application/octet-stream", file_size: file.size,
    storage_path: storagePath, description: String(form.get("description") ?? "").trim() || null,
    uploaded_by_user_id: context.userId,
  }).select("id,attachment_type,file_name,mime_type,file_size,description,uploaded_by_user_id,uploaded_at").single();
  if (inserted.error) {
    await objectStore.removeAttachment(storagePath);
    return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  }
  return NextResponse.json({ attachment: inserted.data }, { status: 201 });
}
