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
    const { data, error } = await admin
      .from("pilot_range_workspaces")
      .select("department_id, workspace, updated_at, updated_by_user_id")
      .eq("department_id", departmentId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    const [standardsResult, componentsResult] = await Promise.all([
      admin
        .from("department_qualification_standards")
        .select("id, firearm_type")
        .eq("department_id", departmentId)
        .eq("is_active", true),
      admin
        .from("department_qualification_standard_components")
        .select(
          "qualification_standard_id, name, scoring_basis, passing_score, passing_time_seconds, minimum_hits, is_required",
        )
        .eq("department_id", departmentId)
        .eq("is_active", true)
        .order("sort_order"),
    ]);

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

    const rawWorkspace =
      data?.workspace && typeof data.workspace === "object"
        ? (data.workspace as Record<string, unknown>)
        : null;

    const rawDrills = Array.isArray(rawWorkspace?.rangeDayDrills)
      ? rawWorkspace.rangeDayDrills
      : [];

    const rangeDayDrills = rawDrills.map((value) => {
      if (!value || typeof value !== "object") return value;

      const drill = value as Record<string, unknown>;

      const drillName = String(drill.name ?? "").toLowerCase();
      const drillCategory = String(drill.category ?? "").toLowerCase();

      const isQualification =
        drillName.includes("qualification") ||
        drillCategory.includes("qualification");

      if (!isQualification) return drill;

      const firearmType = String(drill.firearmType ?? "").toLowerCase();

      const standard = standards.find(
        (candidate) =>
          String(candidate.firearm_type ?? "").toLowerCase() === firearmType,
      );

      if (!standard) return drill;

      const periodText = [
        drill.name,
        drill.laneOrRelay,
        drill.rangeType,
      ]
        .map((item) => String(item ?? "").toLowerCase())
        .join(" ");

      const desiredPeriod = periodText.includes("night")
        ? "night"
        : periodText.includes("day")
          ? "day"
          : null;

      const matchingComponents = components.filter(
        (component) =>
          component.qualification_standard_id === standard.id &&
          component.is_required !== false,
      );

      const component =
        matchingComponents.find((candidate) => {
          if (!desiredPeriod) return false;

          return candidate.name
            .toLowerCase()
            .includes(desiredPeriod);
        }) ??
        (matchingComponents.length === 1
          ? matchingComponents[0]
          : undefined);

      if (!component) return drill;

      if (
        component.scoring_basis === "Hit Count" &&
        typeof component.minimum_hits === "number"
      ) {
        return {
          ...drill,
          passingScore: component.minimum_hits,
          minimumHits: component.minimum_hits,
          isDepartmentStandard: true,
          departmentStandardScoringBasis: "Hit Count",
          departmentStandardMinimumHits: component.minimum_hits,
        };
      }

      if (
        component.scoring_basis === "Points" &&
        typeof component.passing_score === "number"
      ) {
        return {
          ...drill,
          passingScore: component.passing_score,
          isDepartmentStandard: true,
          departmentStandardScoringBasis: "Points",
          departmentStandardMinimumScore: component.passing_score,
        };
      }

      if (
        component.scoring_basis === "Time" &&
        typeof component.passing_time_seconds === "number"
      ) {
        return {
          ...drill,
          passingTimeSeconds: component.passing_time_seconds,
          isDepartmentStandard: true,
          departmentStandardScoringBasis: "Time",
          departmentStandardPassingTimeSeconds:
            component.passing_time_seconds,
        };
      }

      return drill;
    });

    const workspace = rawWorkspace
      ? {
          ...rawWorkspace,
          rangeDayDrills,
        }
      : null;

    return NextResponse.json({
      departmentId,
      workspace,
      updatedAt: data?.updated_at ?? null,
      updatedByUserId: data?.updated_by_user_id ?? null,
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







