import { NextRequest, NextResponse } from "next/server";

import {
  attachmentPathFromMetadata,
  createObjectStore,
} from "@/lib/storage/object-store";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { auditFleet, canConfigureFleet, canManageFleet, canPerformFleetMaintenance, canViewNetworkDetails, nullableDate, nullableText, numeric, refreshFleetVehicle, text } from "@/lib/tracepoint/fleet-server";
import { createFleetReadRepository } from "@/lib/fleet/read-repository";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId } = await params;

  let detail;
  try { detail = await createFleetReadRepository(context.admin, context.departmentId).getVehicleDetail({ departmentId: context.departmentId, vehicleId, canViewNetworkDetails: (rules) => canViewNetworkDetails(context, rules) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Fleet records could not be loaded." }, { status: 500 }); }
  if (!detail) return NextResponse.json({ error: "Vehicle was not found." }, { status: 404 });

  const inspections = detail.inspections as Array<Record<string, unknown>>;
  const inspectionIds = inspections.map((inspection) =>
    String(inspection.id),
  );
  const evidenceByInspection = new Map<string, Record<string, unknown>[]>();

  if (inspectionIds.length) {
    const evidenceResult = await context.admin
      .from("attachments")
      .select(
        "id,entity_id,attachment_type,file_name,storage_path,mime_type,file_size,description,uploaded_at",
      )
      .eq("department_id", context.departmentId)
      .eq("entity_type", "fleet_vehicle_inspection")
      .in("entity_id", inspectionIds)
      .is("archived_at", null)
      .order("uploaded_at", { ascending: false });

    if (evidenceResult.error) {
      return NextResponse.json(
        { error: evidenceResult.error.message },
        { status: 500 },
      );
    }

    const objectStore = await createObjectStore(context.admin, context.departmentId);
    const evidence = await Promise.all(
      (evidenceResult.data ?? []).map(async (attachment: Record<string, unknown>) => {
        if (typeof attachment.storage_path !== "string") return null;
        const path = attachmentPathFromMetadata(
          attachment.storage_path,
          context.departmentId,
        );
        if (!path) return null;
        const view = await objectStore.createAttachmentView(path);
        if (view.error || !view.signedUrl) return null;
        return {
          id: attachment.id,
          inspectionId: attachment.entity_id,
          attachmentType: attachment.attachment_type,
          fileName: attachment.file_name,
          mimeType: attachment.mime_type,
          fileSize: attachment.file_size,
          description: attachment.description,
          uploadedAt: attachment.uploaded_at,
          viewUrl: view.signedUrl,
          downloadUrl: `/api/attachments/${attachment.id}/download`,
        };
      }),
    );

    for (const item of evidence) {
      if (!item) continue;
      const inspectionEvidence = evidenceByInspection.get(item.inspectionId) ?? [];
      inspectionEvidence.push(item);
      evidenceByInspection.set(item.inspectionId, inspectionEvidence);
    }
  }

  return NextResponse.json({
    ...detail,
    inspections: inspections.map((inspection) => ({
      ...inspection,
      evidence: evidenceByInspection.get(String(inspection.id)) ?? [],
    })),
    canManage: canManageFleet(context, detail.rules),
    canMaintain: canPerformFleetMaintenance(context, detail.rules),
    canConfigure: canConfigureFleet(context),
    canViewNetworkDetails: canViewNetworkDetails(context, detail.rules),
    roleCodes: context.roleCodes,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId } = await params;
  const { data: rules } = await context.admin.from("fleet_rules").select("fleet_manager_role_codes").eq("department_id", context.departmentId).maybeSingle();
  if (!canManageFleet(context, rules)) return NextResponse.json({ error: "Fleet Manager access is required." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = text(body.reason, 1000);
  if (!reason) return NextResponse.json({ error: "A reason for the vehicle update is required." }, { status: 400 });

  const { data: previous, error: loadError } = await context.admin.from("fleet_vehicles").select("*").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
  if (loadError || !previous) return NextResponse.json({ error: loadError?.message ?? "Vehicle was not found." }, { status: loadError ? 500 : 404 });

  const update: Record<string, unknown> = { updated_by_user_id: context.user.id, updated_at: new Date().toISOString() };
  const fields: Array<[string, string]> = [["status","status"],["assignedTo","assigned_to"],["homeLocation","home_location"],["comments","comments"]];
  for (const [input, column] of fields) if (body[input] !== undefined) update[column] = nullableText(body[input], 5000);
  if (body.currentMileage !== undefined) update.current_mileage = Math.round(numeric(body.currentMileage));
  if (body.currentHours !== undefined) update.current_hours = numeric(body.currentHours);
  if (body.nextServiceDate !== undefined) update.next_service_date = nullableDate(body.nextServiceDate);
  if (body.nextServiceMileage !== undefined) update.next_service_mileage = numeric(body.nextServiceMileage) || null;
  if (body.nextServiceHours !== undefined) update.next_service_hours = numeric(body.nextServiceHours) || null;
  if (body.status !== undefined) update.status_reason = reason;
  if (body.status !== undefined) update.status_override_active = true;
  if (body.clearStatusOverride === true) update.status_override_active = false;

  const { data, error } = await context.admin.from("fleet_vehicles").update(update).eq("department_id", context.departmentId).eq("id", vehicleId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try { await auditFleet(context, "fleet_vehicle_updated", "fleet_vehicle", vehicleId, { reason, previous, current: data }); }
  catch (auditError) { await context.admin.from("fleet_vehicles").update(previous).eq("department_id", context.departmentId).eq("id", vehicleId); return NextResponse.json({ error: auditError instanceof Error ? auditError.message : "Audit failed; update reversed." }, { status: 500 }); }
  await refreshFleetVehicle(context, vehicleId);
  return NextResponse.json({ ok: true, vehicle: data });
}
