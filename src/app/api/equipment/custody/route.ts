import { NextRequest, NextResponse } from "next/server";

import {
  getEquipmentServerContext,
  text,
} from "@/lib/tracepoint/equipment-server";

export const dynamic = "force-dynamic";

const ASSET_FIELDS = [
  "id",
  "manufacturer",
  "model",
  "serial_number",
  "asset_number",
  "lifecycle_status",
  "assigned_user_id",
  "assigned_vehicle_id",
  "assigned_location",
].join(",");

type EquipmentAsset = {
  id: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  asset_number: string | null;
  lifecycle_status: string | null;
  assigned_user_id: string | null;
  assigned_vehicle_id: string | null;
  assigned_location: string | null;
};

const VALID_CONDITIONS = new Set([
  "serviceable",
  "damaged",
  "missing_parts",
  "out_of_service",
]);

export async function GET(request: NextRequest) {
  const context = await getEquipmentServerContext();
  if ("error" in context) return context.error;

  const identifier = normalizeIdentifier(request.nextUrl.searchParams.get("identifier"));
  if (!identifier) {
    return errorResponse("An equipment ID, asset number, or serial number is required.", 400);
  }

  const { data, error } = await context.admin
    .from("equipment_assets")
    .select(ASSET_FIELDS)
    .eq("department_id", context.departmentId)
    .neq("lifecycle_status", "removed");

  if (error) return errorResponse(error.message, 500);

  const item = (data as EquipmentAsset[] | null)?.find((asset) =>
    [asset.id, asset.asset_number, asset.serial_number]
      .filter(Boolean)
      .some((value) => normalizeIdentifier(value) === identifier),
  );

  if (!item) return errorResponse("No equipment in your agency matches that identifier.", 404);

  const history = await custodyHistory(
    context.admin,
    context.departmentId,
    item.id,
    context.user.id,
  );

  return NextResponse.json({
    item: { ...publicAsset(item, context.user.id), history },
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const context = await getEquipmentServerContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => ({}));
  const id = text(body.id);
  const action = text(body.action);
  const condition = text(body.condition) || "serviceable";
  const notes = text(body.notes).slice(0, 1000);

  if (!id || !["check-in", "check-out"].includes(action)) {
    return errorResponse("A valid equipment ID and custody action are required.", 400);
  }
  if (!VALID_CONDITIONS.has(condition)) {
    return errorResponse("Choose a valid equipment condition.", 400);
  }
  if (condition !== "serviceable" && !notes) {
    return errorResponse("Add a short note for equipment that is not serviceable.", 400);
  }
  if (action === "check-out" && condition !== "serviceable") {
    return errorResponse("Only serviceable equipment can be checked out.", 409);
  }

  const { data: existing, error: existingError } = await context.admin
    .from("equipment_assets")
    .select(ASSET_FIELDS)
    .eq("department_id", context.departmentId)
    .eq("id", id)
    .maybeSingle();

  if (existingError) return errorResponse(existingError.message, 500);
  if (!existing) return errorResponse("Equipment was not found in your agency.", 404);

  const asset = existing as EquipmentAsset;
  if (asset.lifecycle_status !== "active") {
    return errorResponse("Only active equipment can be checked in or out.", 409);
  }

  if (action === "check-out") {
    if (asset.assigned_user_id === context.user.id) {
      return errorResponse("This equipment is already checked out to you.", 409);
    }
    if (asset.assigned_user_id || asset.assigned_vehicle_id || asset.assigned_location) {
      return errorResponse("This equipment is already assigned and is not available for checkout.", 409);
    }

    const { data, error } = await context.admin
      .from("equipment_assets")
      .update({
        assigned_user_id: context.user.id,
        updated_by: context.user.id,
      })
      .eq("department_id", context.departmentId)
      .eq("id", id)
      .eq("lifecycle_status", "active")
      .is("assigned_user_id", null)
      .is("assigned_vehicle_id", null)
      .is("assigned_location", null)
      .select(ASSET_FIELDS)
      .maybeSingle();

    if (error) return errorResponse(error.message, 500);
    if (!data) return errorResponse("This equipment was checked out by someone else.", 409);
    await annotateAssignment(
      context.admin,
      context.departmentId,
      id,
      "assignment_notes",
      custodyNote(condition, notes),
    );
    return custodyResponse(
      context.admin,
      context.departmentId,
      data as EquipmentAsset,
      context.user.id,
      "checked-out",
    );
  }

  if (asset.assigned_user_id !== context.user.id) {
    return errorResponse("You can check in only equipment currently assigned to you.", 403);
  }

  const { data, error } = await context.admin
    .from("equipment_assets")
    .update({
      assigned_user_id: null,
      lifecycle_status: condition === "serviceable" ? "active" : "out_of_service",
      updated_by: context.user.id,
    })
    .eq("department_id", context.departmentId)
    .eq("id", id)
    .eq("assigned_user_id", context.user.id)
    .select(ASSET_FIELDS)
    .maybeSingle();

  if (error) return errorResponse(error.message, 500);
  if (!data) return errorResponse("Equipment custody changed before check-in completed.", 409);
  await annotateAssignment(
    context.admin,
    context.departmentId,
    id,
    "return_notes",
    custodyNote(condition, notes),
  );
  return custodyResponse(
    context.admin,
    context.departmentId,
    data as EquipmentAsset,
    context.user.id,
    "checked-in",
  );
}

function normalizeIdentifier(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
}

function publicAsset(item: EquipmentAsset, userId: string) {
  const custody = item.assigned_user_id === userId
    ? "mine"
    : item.assigned_user_id || item.assigned_vehicle_id || item.assigned_location
      ? "assigned"
      : "available";

  return {
    id: item.id,
    manufacturer: item.manufacturer,
    model: item.model,
    serial_number: item.serial_number,
    asset_number: item.asset_number,
    lifecycle_status: item.lifecycle_status,
    assigned_location: custody === "assigned" && item.assigned_location
      ? item.assigned_location
      : null,
    custody,
  };
}

async function custodyResponse(
  admin: any,
  departmentId: string,
  item: EquipmentAsset,
  userId: string,
  result: string,
) {
  const history = await custodyHistory(admin, departmentId, item.id, userId);
  return NextResponse.json({
    item: { ...publicAsset(item, userId), history },
    result,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function annotateAssignment(
  admin: any,
  departmentId: string,
  assetId: string,
  field: "assignment_notes" | "return_notes",
  note: string,
) {
  const query = admin
    .from("equipment_asset_assignments")
    .update({ [field]: note })
    .eq("department_id", departmentId)
    .eq("equipment_asset_id", assetId);

  if (field === "assignment_notes") {
    await query.is("returned_at", null);
    return;
  }

  const latest = await admin
    .from("equipment_asset_assignments")
    .select("id")
    .eq("department_id", departmentId)
    .eq("equipment_asset_id", assetId)
    .not("returned_at", "is", null)
    .order("returned_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.data?.id) {
    await admin
      .from("equipment_asset_assignments")
      .update({ return_notes: note })
      .eq("id", latest.data.id)
      .eq("department_id", departmentId);
  }
}

async function custodyHistory(
  admin: any,
  departmentId: string,
  assetId: string,
  viewerUserId: string,
) {
  const { data } = await admin
    .from("equipment_asset_assignments")
    .select("id,assigned_at,returned_at,assignment_notes,return_notes,assigned_by,returned_by")
    .eq("department_id", departmentId)
    .eq("equipment_asset_id", assetId)
    .order("assigned_at", { ascending: false })
    .limit(10);

  const assignments = data ?? [];
  const actorIds = [...new Set(assignments.flatMap((assignment: any) => [
    assignment.assigned_by,
    assignment.returned_by,
  ]).filter(Boolean))];
  const profiles = actorIds.length
    ? ((await admin.from("profiles").select("id,full_name").in("id", actorIds)).data ?? [])
    : [];
  const actorNames = new Map(profiles.map((profile: any) => [
    profile.id,
    profile.full_name || "TracePoint user",
  ]));
  const actorName = (id: unknown) => id === viewerUserId
    ? "You"
    : actorNames.get(id) || "TracePoint user";

  return assignments
    .flatMap((assignment: any) => {
      const events = [{
        id: `${assignment.id}:out`,
        action: "check-out",
        occurredAt: assignment.assigned_at,
        actorUserId: assignment.assigned_by,
        actorName: actorName(assignment.assigned_by),
        ...parseCustodyNote(assignment.assignment_notes),
      }];
      if (assignment.returned_at) {
        events.push({
          id: `${assignment.id}:in`,
          action: "check-in",
          occurredAt: assignment.returned_at,
          actorUserId: assignment.returned_by,
          actorName: actorName(assignment.returned_by),
          ...parseCustodyNote(assignment.return_notes),
        });
      }
      return events;
    })
    .sort((left: any, right: any) =>
      String(right.occurredAt).localeCompare(String(left.occurredAt)),
    )
    .slice(0, 10);
}

function custodyNote(condition: string, notes: string) {
  return `[condition=${condition}]${notes ? ` ${notes}` : ""}`;
}

function parseCustodyNote(value: unknown) {
  const note = text(value);
  const match = note.match(/^\[condition=([a-z_]+)\]\s*([\s\S]*)$/);
  return match
    ? { condition: match[1], notes: match[2] || null }
    : { condition: "not_recorded", notes: note || null };
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
