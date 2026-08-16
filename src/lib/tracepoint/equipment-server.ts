import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export async function getEquipmentServerContext() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return {
      error: accessFailureResponse(resolved),
    } as const;
  }

  const access = resolved.context;

  const featureError = requireServerFeature(
    access,
    "equipment_readiness",
    "Equipment Readiness",
  );

  if (featureError) {
    return {
      error: featureError,
    } as const;
  }

  return {
    admin: access.admin,
    user: access.user,
    departmentId: access.departmentId,
    canManage: hasAnyServerPermission(access, [
      "manage_equipment",
    ]),
    canViewDepartment: hasAnyServerPermission(access, [
      "manage_equipment",
      "view_command_dashboard",
      "view_analytics",
    ]),
  } as const;
}

export function equipmentPermissionDenied() {
  return NextResponse.json(
    {
      error:
        "You do not have permission to manage equipment.",
    },
    {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

export function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

export function nullableInteger(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed)
    ? parsed
    : null;
}
