import { NextRequest, NextResponse } from "next/server";

import { parseCognitoRuntimeConfiguration } from "@/lib/authentication/cognito-runtime-configuration-core";
import { authorizeInspectionEvidence } from "@/lib/fleet/inspection-evidence";
import { openMobileUploadIntent } from "@/lib/storage/mobile-upload-intent";
import { createS3MobileObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { auditFleet, text } from "@/lib/tracepoint/fleet-server";

type Context = { params: Promise<{ vehicleId: string; inspectionId: string }> };

export async function POST(request: NextRequest, routeContext: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const { vehicleId, inspectionId } = await routeContext.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const token = text(body.intent, 4096);
  const intent = openMobileUploadIntent(token, parseCognitoRuntimeConfiguration(process.env).state);
  if (!intent || intent.departmentId !== access.context.departmentId || intent.userId !== access.context.userId ||
      intent.vehicleId !== vehicleId || intent.inspectionId !== inspectionId) {
    return NextResponse.json({ error: "The upload confirmation is invalid or expired." }, { status: 400 });
  }
  const authorized = await authorizeInspectionEvidence(access.context, intent);
  if (!authorized.ok) return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  const store = createS3MobileObjectStore(access.context.departmentId);
  const confirmed = await store.confirmFleetInspectionEvidence(intent.path, {
    objectId: intent.attachmentId,
    contentType: intent.contentType,
    size: intent.size,
  });
  if (confirmed.error) return NextResponse.json({ error: "The uploaded object did not match its authorized metadata." }, { status: 409 });

  const previousEvidence = authorized.checklist.flatMap((item) => Array.isArray(item.evidence) ? item.evidence : [])
    .find((item: Record<string, unknown>) => item.id === intent.attachmentId) as Record<string, unknown> | undefined;
  if (previousEvidence) {
    const same = previousEvidence.storagePath === intent.path && previousEvidence.fileName === intent.fileName &&
      previousEvidence.mimeType === intent.contentType && previousEvidence.size === intent.size &&
      previousEvidence.uploadedByUserId === access.context.userId;
    if (!same) return NextResponse.json({ error: "The attachment identifier is already confirmed with different metadata." }, { status: 409 });
    return NextResponse.json({ ok: true, alreadyConfirmed: true, evidence: previousEvidence }, { headers: { "Cache-Control": "no-store, private" } });
  }

  const evidence = {
    id: intent.attachmentId,
    storagePath: intent.path,
    fileName: intent.fileName,
    mimeType: intent.contentType,
    size: intent.size,
    uploadedAt: new Date().toISOString(),
    uploadedByUserId: access.context.userId,
  };
  const checklist = authorized.checklist.map((item) => item.id === intent.checklistItemId
    ? { ...item, evidence: [...(Array.isArray(item.evidence) ? item.evidence : []), evidence] }
    : item);
  const updated = await access.context.admin.from("fleet_vehicle_inspections")
    .update({ checklist })
    .eq("department_id", access.context.departmentId)
    .eq("vehicle_id", vehicleId)
    .eq("id", inspectionId)
    .eq("checklist", authorized.inspection.checklist)
    .select("id")
    .maybeSingle();
  if (updated.error || !updated.data) {
    await store.removeAttachment(intent.path);
    return NextResponse.json({ error: updated.error ? "Inspection evidence confirmation failed." : "The inspection changed. Retry the upload." }, { status: updated.error ? 500 : 409 });
  }
  try {
    await auditFleet(access.context, "fleet_vehicle_inspection_evidence_uploaded", "fleet_vehicle", vehicleId, {
      inspection_id: inspectionId,
      checklist_item_id: intent.checklistItemId,
      attachment_id: intent.attachmentId,
    });
  } catch {
    await access.context.admin.from("fleet_vehicle_inspections").update({ checklist: authorized.checklist })
      .eq("department_id", access.context.departmentId).eq("vehicle_id", vehicleId).eq("id", inspectionId).eq("checklist", checklist);
    await store.removeAttachment(intent.path);
    return NextResponse.json({ error: "Inspection evidence audit failed; the upload was reversed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, evidence }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
}
