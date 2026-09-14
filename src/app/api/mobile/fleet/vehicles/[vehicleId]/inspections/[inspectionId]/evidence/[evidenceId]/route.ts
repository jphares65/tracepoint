import { NextResponse } from "next/server";

import { attachmentPathFromMetadata, createS3MobileObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ vehicleId: string; inspectionId: string; evidenceId: string }> };

export async function GET(_request: Request, routeContext: Context) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["view_fleet", "manage_fleet", "perform_fleet_inspections", "manage_fleet_maintenance", "manage_fleet_rules"])) {
    return NextResponse.json({ error: "Fleet access is required." }, { status: 403 });
  }
  const { vehicleId, inspectionId, evidenceId } = await routeContext.params;
  const result = await access.context.admin.from("fleet_vehicle_inspections").select("checklist")
    .eq("department_id", access.context.departmentId).eq("vehicle_id", vehicleId).eq("id", inspectionId).maybeSingle();
  if (result.error) return NextResponse.json({ error: "Inspection evidence could not be loaded." }, { status: 500 });
  if (!result.data) return NextResponse.json({ error: "Inspection was not found." }, { status: 404 });
  const checklist = Array.isArray(result.data.checklist) ? result.data.checklist : [];
  const evidence = checklist.flatMap((item: Record<string, unknown>) => Array.isArray(item.evidence) ? item.evidence : [])
    .find((item: Record<string, unknown>) => item.id === evidenceId) as Record<string, unknown> | undefined;
  const path = attachmentPathFromMetadata(String(evidence?.storagePath ?? ""), access.context.departmentId);
  if (!evidence || !path) return NextResponse.json({ error: "Inspection evidence was not found." }, { status: 404 });
  const delivery = await createS3MobileObjectStore(access.context.departmentId).createAttachmentView(path);
  if (delivery.error || !delivery.signedUrl) return NextResponse.json({ error: "Inspection evidence is unavailable." }, { status: 502 });
  return NextResponse.json({ url: delivery.signedUrl, expiresIn: 60 }, { headers: { "Cache-Control": "no-store, private" } });
}
