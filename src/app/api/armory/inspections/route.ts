import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  result: "Passed" | "Failed" | "Needs Maintenance" | "Removed from Service";
  serviceRecommendation?: string;
  followUpDate?: string | null;
  correctiveAction?: string;
  notes?: string;
  checklist?: ChecklistItemPayload[];
};

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase server configuration. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getStatusForInspectionResult(result: InspectionPayload["result"]) {
  if (result === "Failed") return "Inspection Required";
  if (result === "Needs Maintenance") return "Maintenance";
  if (result === "Removed from Service") return "Out of Service";

  return null;
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("firearm_inspections")
      .select(
        `
        *,
        firearm:firearms (
          id,
          make,
          model,
          serial_number,
          asset_number,
          condition_status
        ),
        items:firearm_inspection_items (
          id,
          section,
          label,
          status,
          note,
          critical,
          sort_order
        )
      `,
      )
      .order("inspection_date", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ inspections: data ?? [] });
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
    const supabase = getSupabaseAdmin();
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

    if (!body.result) {
      return NextResponse.json(
        { error: "result is required." },
        { status: 400 },
      );
    }

    const { data: firearm, error: firearmError } = await supabase
      .from("firearms")
      .select("id, department_id, condition_status")
      .eq("id", body.firearmId)
      .single();

    if (firearmError || !firearm) {
      return NextResponse.json(
        { error: firearmError?.message ?? "Firearm not found." },
        { status: 404 },
      );
    }

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
        inspector_name: body.inspectorName?.trim() || null,
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
      })
      .select("*")
      .single();

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
              "Inspection was created, but checklist items could not be saved: " +
              itemError.message,
          },
          { status: 500 },
        );
      }
    }

    const nextStatus = getStatusForInspectionResult(body.result);

    if (nextStatus && nextStatus !== firearm.condition_status) {
      const { error: statusError } = await supabase
        .from("firearms")
        .update({
          condition_status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.firearmId);

      if (statusError) {
        return NextResponse.json(
          {
            error:
              "Inspection was saved, but firearm status could not be updated: " +
              statusError.message,
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