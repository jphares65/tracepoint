import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createObjectStore } from "@/lib/storage/object-store";

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
  const event = await eventExists(context.admin, context.departmentId, eventId);
  if (event.error) return NextResponse.json({ error: event.error.message }, { status: 500 });
  if (!event.data) return NextResponse.json({ error: "Training event not found." }, { status: 404 });

  const [files, certificates] = await Promise.all([
    context.admin.from("attachments")
      .select("id,attachment_type,file_name,mime_type,file_size,description,uploaded_by_user_id,uploaded_at")
      .eq("department_id", context.departmentId).eq("entity_type", "agency_training_event")
      .eq("entity_id", eventId).is("archived_at", null).order("uploaded_at", { ascending: false }),
    context.admin.from("agency_training_certificates")
      .select("id,user_id,certificate_number,certificate_title,issued_at,revoked_at")
      .eq("department_id", context.departmentId).eq("event_id", eventId).order("issued_at", { ascending: true }),
  ]);
  if (files.error) return NextResponse.json({ error: files.error.message }, { status: 500 });
  if (certificates.error) return NextResponse.json({ error: certificates.error.message }, { status: 500 });

  const userIds = [...new Set((certificates.data ?? []).map((row: any) => String(row.user_id)))];
  const profiles = userIds.length ? await context.admin.from("profiles").select("id,full_name").in("id", userIds) : { data: [], error: null };
  if (profiles.error) return NextResponse.json({ error: profiles.error.message }, { status: 500 });
  const names = new Map((profiles.data ?? []).map((row: any) => [String(row.id), row.full_name]));
  return NextResponse.json({
    status: event.data.status,
    files: files.data ?? [],
    certificates: (certificates.data ?? []).map((row: any) => ({ ...row, fullName: names.get(String(row.user_id)) ?? "Department Member" })),
    canManage: hasAnyServerPermission(context, MANAGE),
  }, { headers: { "Cache-Control": "no-store" } });
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
