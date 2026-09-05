import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { canManageFleet } from "@/lib/tracepoint/fleet-server";
import { createFleetReadRepository } from "@/lib/fleet/read-repository";
import { FleetReadRepositoryError } from "@/lib/fleet/read-repository-core";

export const dynamic = "force-dynamic";

const FLEET_STATUSES = [
  "Available",
  "Attention",
  "Maintenance",
  "Out of Service",
  "Retired",
] as const;

const ASSIGNMENT_TYPES = ["Pool", "Permanent", "Specialized"] as const;

type FleetStatus = (typeof FLEET_STATUSES)[number];
type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

const VEHICLE_SELECT = [
  "id",
  "unit_number",
  "vin",
  "license_plate",
  "year",
  "make",
  "model",
  "vehicle_type",
  "assignment_type",
  "assigned_to",
  "home_location",
  "current_mileage",
  "current_hours",
  "status",
  "inspection_due_date",
  "registration_expiration_date",
  "insurance_expiration_date",
  "in_service_date",
  "last_service_date",
  "last_service_mileage",
  "last_service_hours",
  "next_service_date",
  "next_service_mileage",
  "next_service_hours",
  "open_issue_count",
  "comments",
  "notes",
  "retired_at",
  "updated_by_user_id",
  "created_at",
  "updated_at",
].join(",");

function clean(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function nullableText(value: unknown, maximum = 500) {
  const result = clean(value, maximum);
  return result || null;
}

function nullableDate(value: unknown) {
  const result = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function optionalInteger(value: unknown, minimum: number, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number.parseInt(String(value), 10);
  return Number.isFinite(result)
    ? Math.min(maximum, Math.max(minimum, result))
    : null;
}

function requiredInteger(value: unknown, minimum: number, maximum: number) {
  return optionalInteger(value, minimum, maximum) ?? minimum;
}

function normalizeStatus(value: unknown): FleetStatus {
  return FLEET_STATUSES.includes(value as FleetStatus)
    ? (value as FleetStatus)
    : "Available";
}

function normalizeAssignment(value: unknown): AssignmentType {
  return ASSIGNMENT_TYPES.includes(value as AssignmentType)
    ? (value as AssignmentType)
    : "Pool";
}

function fleetNeedsMigration(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    (message.includes("fleet_vehicles") &&
      (message.includes("schema cache") || message.includes("does not exist")))
  );
}

function fleetUnavailable(error: { code?: string; message?: string } | null) {
  return fleetNeedsMigration(error)
    ? "Fleet V1 is installed, but its database migration has not been applied."
    : error?.message || "Fleet records could not be loaded.";
}

export async function GET() {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);

  const resolved = access.context;
  try {
    const { rules, items } = await createFleetReadRepository(resolved.admin, resolved.departmentId).getVehicleList({ departmentId: resolved.departmentId, vehicleFields: VEHICLE_SELECT });
    return NextResponse.json({ items, canManage: canManageFleet(resolved, rules) });
  } catch (error) {
    const providerError = error instanceof FleetReadRepositoryError ? { code: error.code, message: error.message } : null;
    return NextResponse.json(
      { error: fleetUnavailable(providerError) },
      { status: fleetNeedsMigration(providerError) ? 503 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);

  const resolved = access.context;
  const { data: rules } = await resolved.admin.from("fleet_rules").select("fleet_manager_role_codes").eq("department_id", resolved.departmentId).maybeSingle();
  if (!canManageFleet(resolved, rules)) {
    return NextResponse.json(
      { error: "Fleet management permission is required." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const unitNumber = clean(body.unitNumber, 50);
  if (!unitNumber) {
    return NextResponse.json({ error: "Unit number is required." }, { status: 400 });
  }

  const vin = nullableText(body.vin, 17)?.toUpperCase() ?? null;
  if (vin && vin.length !== 17) {
    return NextResponse.json(
      { error: "VIN must contain exactly 17 characters when provided." },
      { status: 400 },
    );
  }

  const record = {
    department_id: resolved.departmentId,
    unit_number: unitNumber,
    vin,
    license_plate: nullableText(body.licensePlate, 30)?.toUpperCase() ?? null,
    year: optionalInteger(body.year, 1900, 2200),
    make: nullableText(body.make, 100),
    model: nullableText(body.model, 150),
    vehicle_type: nullableText(body.vehicleType, 100),
    assignment_type: normalizeAssignment(body.assignmentType),
    assigned_to: nullableText(body.assignedTo, 200),
    home_location: nullableText(body.homeLocation, 200),
    current_mileage: requiredInteger(body.currentMileage, 0, 10_000_000),
    current_hours: Math.max(0, Number(body.currentHours) || 0),
    status: normalizeStatus(body.status),
    inspection_due_date: nullableDate(body.inspectionDueDate),
    registration_expiration_date: nullableDate(body.registrationExpirationDate),
    insurance_expiration_date: nullableDate(body.insuranceExpirationDate),
    in_service_date: nullableDate(body.inServiceDate),
    last_service_date: nullableDate(body.lastServiceDate),
    last_service_mileage: optionalInteger(body.lastServiceMileage, 0, 10_000_000),
    last_service_hours: body.lastServiceHours === null || body.lastServiceHours === undefined || body.lastServiceHours === ""
      ? null : Math.max(0, Number(body.lastServiceHours) || 0),
    next_service_date: nullableDate(body.nextServiceDate),
    next_service_mileage: optionalInteger(body.nextServiceMileage, 0, 10_000_000),
    next_service_hours: body.nextServiceHours === null || body.nextServiceHours === undefined || body.nextServiceHours === ""
      ? null : Math.max(0, Number(body.nextServiceHours) || 0),
    open_issue_count: requiredInteger(body.openIssueCount, 0, 10_000),
    comments: nullableText(body.comments, 5000),
    notes: nullableText(body.notes, 5000),
    created_by_user_id: resolved.user.id,
    updated_by_user_id: resolved.user.id,
  };

  const { data, error } = await resolved.admin
    .from("fleet_vehicles")
    .insert(record)
    .select(VEHICLE_SELECT)
    .single();

  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json(
      {
        error: duplicate
          ? "A vehicle with that unit number, VIN, or license plate already exists for this agency."
          : fleetUnavailable(error),
      },
      { status: duplicate ? 409 : fleetNeedsMigration(error) ? 503 : 500 },
    );
  }

  const { error: auditError } = await resolved.admin.from("audit_events").insert({
    department_id: resolved.departmentId,
    actor_user_id: resolved.user.id,
    action: "fleet_vehicle_created",
    entity_type: "fleet_vehicle",
    entity_id: data.id,
    details: {
      current: data,
      support_mode: resolved.isSupportMode,
    },
  });

  if (auditError) {
    await resolved.admin
      .from("fleet_vehicles")
      .delete()
      .eq("department_id", resolved.departmentId)
      .eq("id", data.id);
    return NextResponse.json(
      { error: "The audit record could not be created, so the vehicle was not saved." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);

  const resolved = access.context;
  const { data: rules } = await resolved.admin.from("fleet_rules").select("fleet_manager_role_codes").eq("department_id", resolved.departmentId).maybeSingle();
  if (!canManageFleet(resolved, rules)) {
    return NextResponse.json(
      { error: "Fleet management permission is required." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = clean(body.id, 100);
  const reason = clean(body.reason, 1000);
  if (!id || !reason) {
    return NextResponse.json(
      { error: "Vehicle ID and a reason for the change are required." },
      { status: 400 },
    );
  }

  const { data: existing, error: existingError } = await resolved.admin
    .from("fleet_vehicles")
    .select(VEHICLE_SELECT)
    .eq("department_id", resolved.departmentId)
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: fleetUnavailable(existingError) }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Vehicle was not found." }, { status: 404 });
  }

  const unitNumber = body.unitNumber === undefined
    ? existing.unit_number
    : clean(body.unitNumber, 50);
  if (!unitNumber) {
    return NextResponse.json({ error: "Unit number is required." }, { status: 400 });
  }

  const vin = body.vin === undefined
    ? existing.vin
    : nullableText(body.vin, 17)?.toUpperCase() ?? null;
  if (vin && vin.length !== 17) {
    return NextResponse.json(
      { error: "VIN must contain exactly 17 characters when provided." },
      { status: 400 },
    );
  }

  const nextStatus = body.status === undefined
    ? existing.status as FleetStatus
    : normalizeStatus(body.status);
  const updatedAt = new Date().toISOString();
  const value = (input: string, column: string) =>
    body[input] === undefined ? existing[column] : body[input];
  const nullableHours = (input: string, column: string) => {
    const next = value(input, column);
    return next === null || next === undefined || next === ""
      ? null
      : Math.max(0, Number(next) || 0);
  };
  const update = {
    unit_number: unitNumber,
    vin,
    license_plate: body.licensePlate === undefined
      ? existing.license_plate
      : nullableText(body.licensePlate, 30)?.toUpperCase() ?? null,
    year: optionalInteger(value("year", "year"), 1900, 2200),
    make: nullableText(value("make", "make"), 100),
    model: nullableText(value("model", "model"), 150),
    vehicle_type: nullableText(value("vehicleType", "vehicle_type"), 100),
    assignment_type: body.assignmentType === undefined
      ? existing.assignment_type
      : normalizeAssignment(body.assignmentType),
    assigned_to: nullableText(value("assignedTo", "assigned_to"), 200),
    home_location: nullableText(value("homeLocation", "home_location"), 200),
    current_mileage: requiredInteger(value("currentMileage", "current_mileage"), 0, 10_000_000),
    current_hours: Math.max(0, Number(value("currentHours", "current_hours")) || 0),
    status: nextStatus,
    status_reason: nextStatus === existing.status ? existing.status_reason : reason,
    status_override_active: nextStatus === existing.status ? existing.status_override_active : true,
    inspection_due_date: nullableDate(value("inspectionDueDate", "inspection_due_date")),
    registration_expiration_date: nullableDate(value("registrationExpirationDate", "registration_expiration_date")),
    insurance_expiration_date: nullableDate(value("insuranceExpirationDate", "insurance_expiration_date")),
    in_service_date: nullableDate(value("inServiceDate", "in_service_date")),
    last_service_date: nullableDate(value("lastServiceDate", "last_service_date")),
    last_service_mileage: optionalInteger(value("lastServiceMileage", "last_service_mileage"), 0, 10_000_000),
    last_service_hours: nullableHours("lastServiceHours", "last_service_hours"),
    next_service_date: nullableDate(value("nextServiceDate", "next_service_date")),
    next_service_mileage: optionalInteger(value("nextServiceMileage", "next_service_mileage"), 0, 10_000_000),
    next_service_hours: nullableHours("nextServiceHours", "next_service_hours"),
    open_issue_count: requiredInteger(value("openIssueCount", "open_issue_count"), 0, 10_000),
    comments: nullableText(value("comments", "comments"), 5000),
    notes: nullableText(value("notes", "notes"), 5000),
    retired_at: nextStatus === "Retired" ? existing.retired_at ?? updatedAt : null,
    updated_by_user_id: resolved.user.id,
    updated_at: updatedAt,
  };

  const unchanged = Object.entries(update).every(([column, next]) =>
    ["updated_by_user_id", "updated_at"].includes(column) || existing[column] === next,
  );
  if (unchanged) return NextResponse.json({ ok: true, unchanged: true, item: existing });

  const { data, error } = await resolved.admin
    .from("fleet_vehicles")
    .update(update)
    .eq("department_id", resolved.departmentId)
    .eq("id", id)
    .select(VEHICLE_SELECT)
    .single();

  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { error: duplicate
        ? "A vehicle with that unit number, VIN, or license plate already exists for this agency."
        : "The vehicle could not be updated." },
      { status: duplicate ? 409 : 500 },
    );
  }

  const { error: auditError } = await resolved.admin.from("audit_events").insert({
    department_id: resolved.departmentId,
    actor_user_id: resolved.user.id,
    action: "fleet_vehicle_updated",
    entity_type: "fleet_vehicle",
    entity_id: id,
    details: {
      reason,
      previous: existing,
      current: data,
      support_mode: resolved.isSupportMode,
    },
  });

  if (auditError) {
    await resolved.admin
      .from("fleet_vehicles")
      .update(existing)
      .eq("department_id", resolved.departmentId)
      .eq("id", id);
    return NextResponse.json(
      { error: "The audit record could not be created, so the prior vehicle details were restored." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, item: data });
}
