import { NextResponse } from "next/server";
import { createArmoryReadRepository } from "@/lib/armory/read-repository";
import {
  changeFirearmStatus,
  inspectionPayloadError,
  inspectionStatusNote,
  inspectionTargetStatus,
  type InspectionResult,
} from "@/lib/armory/firearm-status-change";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

type ChecklistItemPayload = {
  id?: string;
  section?: string;
  label: string;
  status: "Pass" | "Fail" | "N/A";
  note?: string;
  critical?: boolean;
};

type InspectionPayload = {
  firearmId: string;
  inspectionType: string;
  inspectionReason?: string;
  inspectionDate?: string;
  inspectorName?: string;
  inspectionLocation?: string;
  assigneeName?: string | null;
  weaponCleared?: string;
  ammunitionRemoved?: string;
  magazinesPresented?: string;
  roundCount?: string;
  opticBatteryStatus?: string;
  cleaningCondition?: string;
  result: InspectionResult;
  serviceRecommendation?: string;
  followUpDate?: string | null;
  correctiveAction?: string;
  notes?: string;
  checklist?: ChecklistItemPayload[];
  idempotencyKey?: unknown;
};

const INSPECTION_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const resolved = await resolveServerAccess();

    if (!resolved.ok) {
      return accessFailureResponse(resolved);
    }

    const context = resolved.context;

    const featureError = requireServerFeature(
      context,
      "firearms",
      "Firearms",
    );

    if (featureError) {
      return featureError;
    }

    const inspections = await createArmoryReadRepository(context.db, context.admin, context.departmentId, context.userId).listInspections({ departmentId: context.departmentId, userId: context.userId });
    return NextResponse.json({ inspections });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load inspection records.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const resolved = await resolveServerAccess();

    if (!resolved.ok) {
      return accessFailureResponse(resolved);
    }

    const context = resolved.context;

    const featureError = requireServerFeature(
      context,
      "firearms",
      "Firearms",
    );

    if (featureError) {
      return featureError;
    }

    if (
      !hasAnyServerPermission(context, [
        "manage_inspections",
        "manage_firearms",
      ])
    ) {
      return permissionDeniedResponse(
        "Inspection-management permission is required to record a firearm inspection.",
      );
    }

    const supabase = context.db;
    const body = (await request.json()) as InspectionPayload;

    if (!body.firearmId) {
      return NextResponse.json(
        { error: "firearmId is required." },
        { status: 400 },
      );
    }

    if (!body.inspectionType) {
      return NextResponse.json(
        { error: "inspectionType is required." },
        { status: 400 },
      );
    }

    const payloadError = inspectionPayloadError(body);

    if (payloadError) {
      return NextResponse.json(
        { error: payloadError },
        { status: 400 },
      );
    }

    // C-07: a request key (065) makes a resubmitted inspection, for example a
    // retry after a lost connection, return the first one instead of
    // recording a duplicate inspection and a second status change.
    const rawKey = body.idempotencyKey;
    const idempotencyKey =
      typeof rawKey === "string" && INSPECTION_KEY.test(rawKey.trim())
        ? rawKey.trim().toLowerCase()
        : null;

    if (rawKey !== undefined && rawKey !== null && rawKey !== "" && !idempotencyKey) {
      return NextResponse.json(
        { error: "The request key is invalid. Reload the page and try again." },
        { status: 400 },
      );
    }

    const replay = async () => {
      if (!idempotencyKey) return null;
      const { data: existing, error: existingError } = await supabase
        .from("firearm_inspections")
        .select("*")
        .eq("department_id", context.departmentId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) return null;
      if (existing.firearm_id !== body.firearmId) {
        return NextResponse.json(
          { error: "This request was already used for a different inspection, so nothing was recorded. Reload and try again." },
          { status: 409 },
        );
      }
      return NextResponse.json({ inspection: existing, updatedFirearmStatus: null, replayed: true });
    };

    const replayed = await replay();
    if (replayed) return replayed;

    const { data: firearm, error: firearmError } = await supabase
      .from("firearms")
      .select("id, department_id, condition_status")
      .eq("id", body.firearmId)
      .eq("department_id", context.departmentId)
      .single();

    if (firearmError || !firearm) {
      return NextResponse.json(
        { error: firearmError?.message ?? "Firearm not found." },
        { status: 404 },
      );
    }

    // The authenticated server session is the authoritative inspection actor.
    // A browser-supplied inspector name must never determine accountability.
    const { data: inspectorProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", context.userId)
      .maybeSingle();

    const inspectionDate = body.inspectionDate
      ? new Date(body.inspectionDate).toISOString()
      : new Date().toISOString();

    const { data: inspection, error: insertError } = await supabase
      .from("firearm_inspections")
      .insert({
        department_id: firearm.department_id,
        firearm_id: body.firearmId,
        inspection_type: body.inspectionType,
        inspection_reason: body.inspectionReason ?? null,
        inspection_date: inspectionDate,
        inspected_by_user_id: context.userId,
        inspector_name: inspectorProfile?.full_name?.trim() || null,
        inspection_location: body.inspectionLocation?.trim() || null,
        assignee_name: body.assigneeName ?? null,
        weapon_cleared: body.weaponCleared ?? null,
        ammunition_removed: body.ammunitionRemoved ?? null,
        magazines_presented: body.magazinesPresented?.trim() || null,
        round_count: body.roundCount?.trim() || null,
        optic_battery_status: body.opticBatteryStatus ?? null,
        cleaning_condition: body.cleaningCondition ?? null,
        result: body.result,
        service_recommendation: body.serviceRecommendation ?? null,
        follow_up_date: body.followUpDate || null,
        corrective_action: body.correctiveAction?.trim() || null,
        notes: body.notes?.trim() || null,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      })
      .select("*")
      .single();

    // Two submissions with one key raced: the other one recorded it.
    if (insertError?.code === "23505" && idempotencyKey) {
      const raced = await replay();
      if (raced) return raced;
    }

    if (insertError || !inspection) {
      return NextResponse.json(
        { error: insertError?.message ?? "Inspection could not be saved." },
        { status: 500 },
      );
    }

    const checklistItems = body.checklist ?? [];

    if (checklistItems.length > 0) {
      const { error: itemError } = await supabase
        .from("firearm_inspection_items")
        .insert(
          checklistItems.map((item, index) => ({
            inspection_id: inspection.id,
            section: item.section ?? "Inspection Checklist",
            label: item.label,
            status: item.status,
            note: item.note?.trim() || null,
            critical: Boolean(item.critical),
            sort_order: index,
          })),
        );

      if (itemError) {
        return NextResponse.json(
          {
            error:
              "Inspection was created, but checklist items could not be saved. Do not record it again; open it from the inspection list. " +
              itemError.message,
          },
          { status: 500 },
        );
      }
    }

    const nextStatus = await inspectionTargetStatus(supabase, {
      departmentId: context.departmentId,
      firearmId: body.firearmId,
      currentStatus: firearm.condition_status,
      result: body.result,
      serviceRecommendation: body.serviceRecommendation,
    });

    if (nextStatus) {
      try {
        const changed = await changeFirearmStatus(supabase, {
          departmentId: context.departmentId,
          firearmId: body.firearmId,
          userId: context.userId,
          fromStatus: firearm.condition_status,
          toStatus: nextStatus,
          notes: inspectionStatusNote(body.result, inspection.id),
        });

        if (!changed) {
          throw new Error("the firearm record changed.");
        }
      } catch (statusError) {
        return NextResponse.json(
          {
            error:
              "Inspection was saved, but firearm status could not be updated. Do not record the inspection again; set the status on the firearm. " +
              (statusError instanceof Error ? statusError.message : "unknown error"),
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      inspection,
      updatedFirearmStatus: nextStatus,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Inspection could not be saved.",
      },
      { status: 500 },
    );
  }
}
