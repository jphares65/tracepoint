import { NextRequest, NextResponse } from "next/server";

import { createObjectStore } from "@/lib/storage/object-store";
import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { auditFleet, text } from "@/lib/tracepoint/fleet-server";

type RouteContext = {
  params: Promise<{ vehicleId: string; inspectionId: string }>;
};

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId, inspectionId } = await routeContext.params;

  const [{ data: inspection, error: inspectionError }, { data: rules }] =
    await Promise.all([
      context.admin
        .from("fleet_vehicle_inspections")
        .select("id,vehicle_id,inspector_user_id")
        .eq("department_id", context.departmentId)
        .eq("vehicle_id", vehicleId)
        .eq("id", inspectionId)
        .maybeSingle(),
      context.admin
        .from("fleet_rules")
        .select("inspection_role_codes")
        .eq("department_id", context.departmentId)
        .maybeSingle(),
    ]);

  if (inspectionError || !inspection) {
    return NextResponse.json(
      { error: inspectionError?.message ?? "Inspection was not found." },
      { status: inspectionError ? 500 : 404 },
    );
  }

  const permittedRoles = Array.isArray(rules?.inspection_role_codes)
    ? rules.inspection_role_codes
    : [];
  const hasPermission =
    context.isSuperAdmin ||
    context.user.id === inspection.inspector_user_id ||
    context.permissions.some((permission: string) =>
      [
        "administer_department",
        "perform_fleet_inspections",
        "manage_fleet",
        "manage_fleet_rules",
      ].includes(permission),
    ) ||
    context.roleCodes.some((role: string) => permittedRoles.includes(role));

  if (!hasPermission) {
    return NextResponse.json(
      { error: "You do not have permission to add inspection evidence." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const checklistItemId = text(form.get("checklistItemId"), 100);
  const checklistItemLabel = text(form.get("checklistItemLabel"), 200);

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Choose a photo or video to upload." },
      { status: 400 },
    );
  }
  if (!checklistItemId || !checklistItemLabel) {
    return NextResponse.json(
      { error: "Inspection checklist context is required." },
      { status: 400 },
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Evidence must be a JPG, PNG, WebP, MP4, MOV, or WebM file." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Inspection evidence may not exceed 25 MB." },
      { status: 400 },
    );
  }

  const attachmentId = crypto.randomUUID();
  const objectStore = await createObjectStore(context.admin, context.departmentId);
  const upload = await objectStore.uploadFleetInspectionEvidence({
    departmentId: context.departmentId,
    recordId: inspectionId,
    objectId: attachmentId,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
  });

  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  const attachmentType = file.type.startsWith("video/") ? "video" : "photo";
  const inserted = await context.admin
    .from("attachments")
    .insert({
      id: attachmentId,
      department_id: context.departmentId,
      entity_type: "fleet_vehicle_inspection",
      entity_id: inspectionId,
      attachment_type: attachmentType,
      file_name: file.name,
      storage_path: upload.path,
      mime_type: file.type,
      file_size: file.size,
      description: `${checklistItemLabel} [${checklistItemId}]`,
      uploaded_by_user_id: context.user.id,
    })
    .select("id,attachment_type,file_name,mime_type,file_size,description,uploaded_at")
    .single();

  if (inserted.error) {
    await objectStore.removeAttachment(upload.path);
    return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  }

  await auditFleet(
    context,
    "fleet_vehicle_inspection_evidence_uploaded",
    "fleet_vehicle",
    vehicleId,
    {
      inspection_id: inspectionId,
      checklist_item_id: checklistItemId,
      attachment_id: attachmentId,
      attachment_type: attachmentType,
    },
  );

  return NextResponse.json({ ok: true, attachment: inserted.data }, { status: 201 });
}
