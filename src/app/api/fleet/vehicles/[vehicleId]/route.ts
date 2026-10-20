import { NextRequest, NextResponse } from "next/server";

import {
  attachmentPathFromMetadata,
  createObjectStore,
} from "@/lib/storage/object-store";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { auditFleet, canConfigureFleet, canManageFleet, canPerformFleetMaintenance, canViewFleetCosts, canViewNetworkDetails, nullableDate, nullableText, numeric, optionalNumeric, refreshFleetVehicle, text } from "@/lib/tracepoint/fleet-server";
import { createFleetReadRepository } from "@/lib/fleet/read-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess(request);
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId } = await params;
  const mobile = request.nextUrl.pathname.startsWith("/api/mobile/");
  const attachmentBase = mobile ? "/api/mobile/attachments" : "/api/attachments";

  let detail;
  try { detail = await createFleetReadRepository(context.admin, context.departmentId).getVehicleDetail({ departmentId: context.departmentId, vehicleId, canViewNetworkDetails: (rules) => canViewNetworkDetails(context, rules), canViewCosts: canViewFleetCosts(context) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Fleet records could not be loaded." }, { status: 500 }); }
  if (!detail) return NextResponse.json({ error: "Vehicle was not found." }, { status: 404 });

  const documentResult = await context.admin.from("attachments")
    .select("id,attachment_type,file_name,mime_type,file_size,description,expiration_date,uploaded_by_user_id,uploaded_at")
    .eq("department_id", context.departmentId).eq("entity_type", "fleet_vehicle_document").eq("entity_id", vehicleId)
    .is("archived_at", null).order("uploaded_at", { ascending: false });
  if (documentResult.error) return NextResponse.json({ error: documentResult.error.message }, { status: 500 });

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

    const objectStore = createObjectStore(context.admin, context.departmentId);
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
          downloadUrl: `${attachmentBase}/${attachment.id}/download`,
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
    documents: [
      ...(documentResult.data ?? []).map((document: Record<string, unknown>) => ({
        ...document, title: document.description || document.file_name, document_type: document.attachment_type,
        viewUrl: `${attachmentBase}/${document.id}/download?disposition=inline`,
        downloadUrl: `${attachmentBase}/${document.id}/download`, managedAttachment: true,
      })),
      ...detail.documents,
    ],
    canManage: canManageFleet(context, detail.rules),
    canMaintain: canPerformFleetMaintenance(context, detail.rules),
    canConfigure: canConfigureFleet(context),
    canViewNetworkDetails: canViewNetworkDetails(context, detail.rules),
    roleCodes: context.roleCodes,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess(request);
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
  const invalidReading = (input: string) => {
    const raw = body[input];
    if (raw === undefined || raw === null || String(raw).trim() === "") return false;
    const reading = Number(raw);
    return !Number.isFinite(reading) || reading < 0 || reading > 10_000_000 || (input === "currentMileage" && !Number.isInteger(reading));
  };
  if (invalidReading("currentMileage") || invalidReading("currentHours")) return NextResponse.json({ error: "Mileage must be a whole number and engine hours a number, from 0 to 10,000,000." }, { status: 400 });
  const currentMileage = optionalNumeric(body.currentMileage);
  const currentHours = optionalNumeric(body.currentHours);
  if (currentMileage !== null) update.current_mileage = currentMileage;
  if (currentHours !== null) update.current_hours = currentHours;
  // Lowering a reading corrects an odometer error: it needs its own reason and is audited as a correction.
  const correction = (currentMileage !== null && currentMileage < (Number(previous.current_mileage) || 0)) || (currentHours !== null && currentHours < (Number(previous.current_hours) || 0));
  const correctionReason = text(body.mileageCorrectionReason, 1000);
  if (correction && !correctionReason) return NextResponse.json({ error: "Lowering the mileage or engine hours is a correction. Enter a reason for the correction." }, { status: 400 });
  if (body.nextServiceDate !== undefined) update.next_service_date = nullableDate(body.nextServiceDate);
  if (body.nextServiceMileage !== undefined) update.next_service_mileage = numeric(body.nextServiceMileage) || null;
  if (body.nextServiceHours !== undefined) update.next_service_hours = numeric(body.nextServiceHours) || null;
  if (body.status !== undefined) update.status_reason = reason;
  if (body.status !== undefined) update.status_override_active = true;
  if (body.clearStatusOverride === true) update.status_override_active = false;

  const { data, error } = await context.admin.from("fleet_vehicles").update(update).eq("department_id", context.departmentId).eq("id", vehicleId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const mileageCorrection = correction ? { mileage_correction: { reason: correctionReason, previous_mileage: previous.current_mileage, new_mileage: data.current_mileage, previous_hours: previous.current_hours, new_hours: data.current_hours } } : {};
  try { await auditFleet(context, correction ? "fleet_odometer_corrected" : "fleet_vehicle_updated", "fleet_vehicle", vehicleId, { reason, previous, current: data, ...mileageCorrection }); }
  catch (auditError) { await context.admin.from("fleet_vehicles").update(previous).eq("department_id", context.departmentId).eq("id", vehicleId); return NextResponse.json({ error: auditError instanceof Error ? auditError.message : "Audit failed; update reversed." }, { status: 500 }); }
  try { await refreshFleetVehicle(context, vehicleId); }
  catch (refreshError) { return NextResponse.json({ error: `The vehicle update was saved, but its readiness was not recalculated. ${refreshError instanceof Error ? refreshError.message : ""}`.trim() }, { status: 500 }); }
  return NextResponse.json({ ok: true, vehicle: data });
}
