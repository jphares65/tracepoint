import { NextRequest, NextResponse } from "next/server";

import { parseCognitoRuntimeConfiguration } from "@/lib/authentication/cognito-runtime-configuration-core";
import { authorizeInspectionEvidence } from "@/lib/fleet/inspection-evidence";
import { createS3MobileObjectStore } from "@/lib/storage/object-store";
import { sealMobileUploadIntent } from "@/lib/storage/mobile-upload-intent";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { text } from "@/lib/tracepoint/fleet-server";

type Context = { params: Promise<{ vehicleId: string; inspectionId: string }> };

export async function POST(request: NextRequest, routeContext: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const { vehicleId, inspectionId } = await routeContext.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const checklistItemId = text(body.checklistItemId, 100);
  const fileName = text(body.fileName, 500);
  const contentType = text(body.contentType, 255).toLowerCase();
  const size = Number(body.size);
  if (!checklistItemId || !fileName || !Number.isSafeInteger(size)) {
    return NextResponse.json({ error: "Valid checklist and file metadata are required." }, { status: 400 });
  }
  const authorized = await authorizeInspectionEvidence(access.context, { vehicleId, inspectionId, checklistItemId });
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });

  const attachmentId = crypto.randomUUID();
  try {
    const store = createS3MobileObjectStore(access.context.departmentId);
    const upload = await store.createFleetInspectionEvidenceUpload({
      departmentId: access.context.departmentId,
      recordId: inspectionId,
      objectId: attachmentId,
      fileName,
      contentType,
      size,
    });
    if (upload.error || !upload.signedUrl) throw new Error("upload unavailable");
    const keyring = parseCognitoRuntimeConfiguration(process.env).state;
    const intent = sealMobileUploadIntent({
      attachmentId,
      departmentId: access.context.departmentId,
      userId: access.context.userId,
      vehicleId,
      inspectionId,
      checklistItemId,
      fileName,
      contentType,
      size,
      path: upload.path,
    }, keyring);
    return NextResponse.json({
      attachmentId,
      uploadUrl: upload.signedUrl,
      uploadMethod: "PUT",
      uploadHeaders: { "Content-Type": contentType },
      expiresIn: upload.expiresIn,
      intent,
    }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Inspection evidence upload could not be authorized." }, { status: 400 });
  }
}
