import { NextRequest, NextResponse } from "next/server";


import {
  accessFailureResponse,
  featureDisabledResponse,
  hasServerFeature,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";

type StoredRangeDayWorkspace = {
  rangeDays?: unknown[];
  drillLibrary?: unknown[];
  rangeDayDrills?: unknown[];
  rangeRoster?: unknown[];
  results?: unknown[];
  malfunctions?: unknown[];
};

function normalizeWorkspace(value: unknown): StoredRangeDayWorkspace {
  const workspace =
    value && typeof value === "object"
      ? (value as StoredRangeDayWorkspace)
      : {};

  return {
    rangeDays: Array.isArray(workspace.rangeDays)
      ? workspace.rangeDays
      : [],
    drillLibrary: Array.isArray(workspace.drillLibrary)
      ? workspace.drillLibrary
      : [],
    rangeDayDrills: Array.isArray(workspace.rangeDayDrills)
      ? workspace.rangeDayDrills
      : [],
    rangeRoster: Array.isArray(workspace.rangeRoster)
      ? workspace.rangeRoster
      : [],
    results: Array.isArray(workspace.results)
      ? workspace.results
      : [],
    malfunctions: Array.isArray(workspace.malfunctions)
      ? workspace.malfunctions
      : [],
  };
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const canReadWorkspace =
    hasServerFeature(resolved.context, "range_training") ||
    hasServerFeature(resolved.context, "qualifications");

  if (!canReadWorkspace) {
    return featureDisabledResponse(
      "Range & Training and Qualifications",
    );
  }
  const {
    admin,
    departmentId,
  } = resolved.context;

  try {
    const data = await createRangeReadRepository(admin, departmentId).getWorkspace(departmentId);

    return NextResponse.json({
      departmentId,
      workspace: data.workspace,
      qualificationStandards: data.qualificationStandards,
      updatedAt: data.updatedAt,
      updatedByUserId: data.updatedByUserId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The pilot range workspace could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "range_training",
    "Range & Training",
  );

  if (featureError) {
    return featureError;
  }
  const {
    admin,
    user,
    departmentId,
  } = resolved.context;

  const body = (await request.json().catch(() => ({}))) as {
    workspace?: unknown;
  };

  const workspace = normalizeWorkspace(body.workspace);

  try {
    const { error } = await admin.from("pilot_range_workspaces").upsert(
      {
        department_id: departmentId,
        workspace,
        updated_by_user_id: user.id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "department_id",
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      departmentId,
      counts: {
        rangeDays: workspace.rangeDays?.length ?? 0,
        drillLibrary: workspace.drillLibrary?.length ?? 0,
        rangeDayDrills: workspace.rangeDayDrills?.length ?? 0,
        rangeRoster: workspace.rangeRoster?.length ?? 0,
        results: workspace.results?.length ?? 0,
        malfunctions: workspace.malfunctions?.length ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The pilot range workspace could not be saved.",
      },
      { status: 500 },
    );
  }
}






