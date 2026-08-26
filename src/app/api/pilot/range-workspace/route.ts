import { NextRequest, NextResponse } from "next/server";


import {
  accessFailureResponse,
  featureDisabledResponse,
  hasServerFeature,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type StoredRangeDayWorkspace = {
  rangeDays?: unknown[];
  drillLibrary?: unknown[];
  rangeDayDrills?: unknown[];
  rangeRoster?: unknown[];
  results?: unknown[];
  malfunctions?: unknown[];
};

type QualificationStandardRow = {
  id: string;
  name: string;
  firearm_type: string | null;
};

type QualificationStandardComponentRow = {
  qualification_standard_id: string;
  name: string;
  scoring_basis: string;
  passing_score: number | null;
  passing_time_seconds: number | null;
  minimum_hits: number | null;
  is_required: boolean;
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
    user,
    departmentId,
  } = resolved.context;

  try {
    const [workspaceResult, standardsResult, componentsResult] =
      await Promise.all([
        admin
          .from("pilot_range_workspaces")
          .select("department_id, workspace, updated_at, updated_by_user_id")
          .eq("department_id", departmentId)
          .maybeSingle(),
        admin
          .from("department_qualification_standards")
          .select("id, name, firearm_type")
          .eq("department_id", departmentId)
          .eq("is_active", true)
          .order("name"),
        admin
          .from("department_qualification_standard_components")
          .select(
            "qualification_standard_id, name, scoring_basis, passing_score, passing_time_seconds, minimum_hits, is_required",
          )
          .eq("department_id", departmentId)
          .eq("is_active", true)
          .order("sort_order")
          .order("name"),
      ]);

    if (workspaceResult.error) {
      throw new Error(workspaceResult.error.message);
    }

    if (standardsResult.error) {
      throw new Error(standardsResult.error.message);
    }

    if (componentsResult.error) {
      throw new Error(componentsResult.error.message);
    }

    const standards =
      (standardsResult.data ?? []) as QualificationStandardRow[];

    const components =
      (componentsResult.data ?? []) as QualificationStandardComponentRow[];

    const qualificationStandards = standards.map((standard) => ({
      id: standard.id,
      name: standard.name,
      firearmType: standard.firearm_type,
      components: components
        .filter(
          (component) =>
            component.qualification_standard_id === standard.id,
        )
        .map((component) => ({
          name: component.name,
          scoringBasis: component.scoring_basis,
          passingScore: component.passing_score,
          passingTimeSeconds: component.passing_time_seconds,
          minimumHits: component.minimum_hits,
          isRequired: component.is_required,
        })),
    }));

    return NextResponse.json({
      departmentId,
      workspace: workspaceResult.data?.workspace ?? null,
      qualificationStandards,
      updatedAt: workspaceResult.data?.updated_at ?? null,
      updatedByUserId:
        workspaceResult.data?.updated_by_user_id ?? null,
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






