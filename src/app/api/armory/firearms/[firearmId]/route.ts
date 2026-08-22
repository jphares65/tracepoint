import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type RouteContext = {
  params: Promise<{ firearmId: string }>;
};

const VALID_FIREARM_TYPES = [
  "handgun",
  "rifle",
  "shotgun",
  "less_lethal",
  "other",
] as const;

function cleanRequiredText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "";
}

export async function PATCH(
  request: NextRequest,
  routeContext: RouteContext,
) {
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
if (!hasAnyServerPermission(context, ["manage_firearms"])) {
    return permissionDeniedResponse(
      "Firearm-management permission is required to edit firearm details.",
    );
  }

  const { firearmId } = await routeContext.params;

  const body = (await request.json().catch(() => ({}))) as {
    make?: string;
    model?: string;
    serialNumber?: string;
    firearmType?: string;
    caliber?: string;
    assetNumber?: string;
    notes?: string;
    changeNote?: string;
  };

  const make = cleanRequiredText(body.make);
  const model = cleanRequiredText(body.model);
  const serialNumber = cleanRequiredText(body.serialNumber);
  const firearmType = cleanRequiredText(body.firearmType);
  const changeNote = cleanRequiredText(body.changeNote);

  if (!make || !model || !serialNumber) {
    return NextResponse.json(
      { error: "Make, model, and serial number are required." },
      { status: 400 },
    );
  }

  if (!VALID_FIREARM_TYPES.includes(firearmType as any)) {
    return NextResponse.json(
      { error: "Invalid firearm type." },
      { status: 400 },
    );
  }

  if (!changeNote) {
    return NextResponse.json(
      { error: "A reason for the change is required." },
      { status: 400 },
    );
  }

  try {
    const { data, error } = await context.admin.rpc(
      "update_firearm_with_audit",
      {
        p_firearm_id: firearmId,
        p_department_id: context.departmentId,
        p_user_id: context.userId,
        p_change_note: changeNote,
        p_make: make,
        p_model: model,
        p_serial_number: serialNumber,
        p_firearm_type: firearmType,
        p_caliber: cleanOptionalText(body.caliber) ?? "TBD / Unknown",
        p_asset_number: cleanOptionalText(body.assetNumber),
        p_notes: cleanOptionalText(body.notes),
      },
    );

    if (error) {
      const message = error.message || "The firearm could not be updated.";

      return NextResponse.json(
        {
          error:
            message.toLowerCase().includes("duplicate") ||
            message.toLowerCase().includes("unique")
              ? "A firearm with this serial number already exists."
              : message,
        },
        {
          status:
            message.includes("No firearm details were changed") ||
            message.includes("required") ||
            message.includes("Invalid")
              ? 400
              : message.toLowerCase().includes("duplicate") ||
                  message.toLowerCase().includes("unique")
                ? 409
                : 500,
        },
      );
    }

    return NextResponse.json(data ?? { ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The firearm could not be updated.",
      },
      { status: 500 },
    );
  }
}

