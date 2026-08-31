import { NextRequest, NextResponse } from "next/server";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createObjectStore } from "@/lib/storage/object-store";

type RouteContext = { params: Promise<{ resultId: string }> };

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function verifyQualificationResult(
  admin: any,
  departmentId: string,
  resultId: string,
) {
  const workspaceRow = await admin
    .from("pilot_range_workspaces")
    .select("workspace")
    .eq("department_id", departmentId)
    .maybeSingle();

  if (workspaceRow.error) {
    return { exists: false, error: workspaceRow.error.message };
  }

  const workspace = workspaceRow.data?.workspace as
    | { results?: Array<{ id?: string }> }
    | null
    | undefined;
  const results = Array.isArray(workspace?.results) ? workspace.results : [];

  return {
    exists: results.some((result) => String(result?.id ?? "") === resultId),
    error: null,
  };
}

export async function GET(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const featureError = requireServerFeature(
    resolved.context,
    "qualifications",
    "Qualifications",
  );

  if (featureError) {
    return featureError;
  }

  const { resultId } = await routeContext.params;
  const { admin, departmentId } = resolved.context;

  const qualification = await verifyQualificationResult(admin, departmentId, resultId);
  if (qualification.error) {
    return NextResponse.json({ error: qualification.error }, { status: 500 });
  }
  if (!qualification.exists) {
    return NextResponse.json({ error: "Qualification result not found." }, { status: 404 });
  }

  const { data, error } = await admin
    .from("attachments")
    .select(
      "id,attachment_type,file_name,mime_type,file_size,description,uploaded_by_user_id,uploaded_at",
    )
    .eq("department_id", departmentId)
    .eq("entity_type", "qualification")
    .eq("entity_key", resultId)
    .is("archived_at", null)
    .order("uploaded_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { attachments: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const featureError = requireServerFeature(
    resolved.context,
    "qualifications",
    "Qualifications",
  );

  if (featureError) {
    return featureError;
  }

  const context = resolved.context;
  if (!hasAnyServerPermission(context, ["manage_qualifications", "manage_range_days"])) {
    return permissionDeniedResponse(
      "Qualification-management permission is required to upload target evidence.",
    );
  }

  const { resultId } = await routeContext.params;
  const qualification = await verifyQualificationResult(
    context.admin,
    context.departmentId,
    resultId,
  );

  if (qualification.error) {
    return NextResponse.json({ error: qualification.error }, { status: 500 });
  }
  if (!qualification.exists) {
    return NextResponse.json({ error: "Qualification result not found." }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const description = String(form.get("description") ?? "").trim().slice(0, 300);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a target photo to upload." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Target evidence must be a JPG, PNG, or WebP image." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Target photos may not exceed 15 MB." }, { status: 400 });
  }

  const attachmentId = crypto.randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const objectStore = createObjectStore(context.admin);
  const upload = await objectStore.uploadQualificationEvidence({
    departmentId: context.departmentId,
    recordId: resultId,
    objectId: attachmentId,
    fileName: file.name,
    bytes,
    contentType: file.type,
  });

  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }
  const storagePath = upload.path;

  const inserted = await context.admin
    .from("attachments")
    .insert({
      id: attachmentId,
      department_id: context.departmentId,
      entity_type: "qualification",
      entity_id: null,
      entity_key: resultId,
      attachment_type: "q_target",
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      file_size: file.size,
      description: description || null,
      uploaded_by_user_id: context.userId,
    })
    .select(
      "id,attachment_type,file_name,mime_type,file_size,description,uploaded_by_user_id,uploaded_at",
    )
    .single();

  if (inserted.error) {
    await objectStore.removeAttachment(storagePath);
    return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  }

  // audit_events.entity_id is UUID-only in the current schema. The qualification
  // result itself is a stable text key inside pilot_range_workspaces, so we record
  // the result key in the audit payload instead of forcing it into entity_id.
  await context.admin.from("audit_events").insert({
    department_id: context.departmentId,
    actor_user_id: context.userId,
    action: "qualification_evidence_uploaded",
    entity_type: "qualification",
    entity_id: null,
    summary: `Uploaded target evidence ${file.name} to a qualification result.`,
    new_value: {
      attachment_id: attachmentId,
      qualification_result_id: resultId,
      attachment_type: "q_target",
      file_name: file.name,
      file_size: file.size,
    },
  });

  return NextResponse.json({ attachment: inserted.data }, { status: 201 });
}

