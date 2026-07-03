import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Workspace = {
  rangeDays?: any[];
  drillLibrary?: any[];
  rangeDayDrills?: any[];
  rangeRoster?: any[];
  results?: any[];
  malfunctions?: any[];
};

type Risk = "Low" | "Medium" | "High";
type Trend = "Improving" | "Stable" | "Monitor" | "Declining" | "Action Needed";

const OFFICER_LABELS: Record<string, { name: string; assignment: string }> = {
  "user-1": { name: "Officer Smith", assignment: "Patrol" },
  "user-2": { name: "Sgt. Williams", assignment: "Supervision" },
  "user-3": { name: "Instructor Jones", assignment: "Firearms Instructor" },
  "user-4": { name: "Armorer Brown", assignment: "Armory" },
  "user-5": { name: "Chief Davis", assignment: "Command" },
  "user-6": { name: "System Administrator", assignment: "Administration" },
};

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeWorkspace(value: unknown): Required<Workspace> {
  const workspace = value && typeof value === "object" ? (value as Workspace) : {};

  return {
    rangeDays: asArray(workspace.rangeDays),
    drillLibrary: asArray(workspace.drillLibrary),
    rangeDayDrills: asArray(workspace.rangeDayDrills),
    rangeRoster: asArray(workspace.rangeRoster),
    results: asArray(workspace.results),
    malfunctions: asArray(workspace.malfunctions),
  };
}

async function getCurrentUser() {
  const supabase = await createServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "You must be signed in." };
  }

  return { user, error: null };
}

async function getActiveDepartmentId(admin: any, userId: string) {
  const { data, error } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data?.department_id ?? null;
}

function dateValue(date?: string) {
  if (!date) return 0;

  const value = new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function formatDate(date?: string) {
  if (!date) return "Missing";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isQualificationDrill(drill: any) {
  const category = String(drill?.category ?? "").toLowerCase();
  const name = String(drill?.name ?? "").toLowerCase();

  return category.includes("qualification") || name.includes("qualification");
}

function isLowLight(drill: any, result: any) {
  const category = String(drill?.category ?? "").toLowerCase();
  const name = String(drill?.name ?? "").toLowerCase();
  const notes = String(result?.notes ?? "").toLowerCase();

  return (
    category.includes("low light") ||
    category.includes("low-light") ||
    name.includes("low light") ||
    name.includes("night") ||
    notes.includes("night")
  );
}

function getOfficerLabel(officerId: string) {
  return (
    OFFICER_LABELS[officerId] ?? {
      name: officerId,
      assignment: "Department Personnel",
    }
  );
}

function getRiskFromStatus(status: string): Risk {
  if (status === "Failed" || status === "Missing Night" || status === "No Record") {
    return "High";
  }

  if (status === "Due Soon" || status === "Monitor") {
    return "Medium";
  }

  return "Low";
}

function scoreValue(result: any) {
  const score = Number(result?.score);

  return Number.isFinite(score) ? score : undefined;
}

function getTrendFromChange(change: number): Trend {
  if (change <= -5) return "Action Needed";
  if (change < -1) return "Declining";
  if (change >= 5) return "Improving";
  return "Stable";
}

function buildPerformanceSummary(workspace: Required<Workspace>) {
  const rangeDayById = new Map(workspace.rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]));
  const drillById = new Map(workspace.rangeDayDrills.map((drill) => [drill.id, drill]));

  const officerIds = Array.from(
    new Set(
      [
        ...workspace.rangeRoster.map((entry) => entry.officerId),
        ...workspace.results.map((result) => result.officerId),
      ].filter(Boolean),
    ),
  );

  const rosterOfficerIds = new Set(workspace.rangeRoster.map((entry) => entry.officerId).filter(Boolean));
  const effectiveOfficerIds =
    officerIds.length > 0 ? officerIds : Array.from(rosterOfficerIds);

  const qualificationTrends = effectiveOfficerIds.map((officerId) => {
    const label = getOfficerLabel(officerId);

    const officerResults = workspace.results
      .filter((result) => result.officerId === officerId)
      .map((result) => ({
        result,
        drill: drillById.get(result.drillId),
        rangeDay: rangeDayById.get(result.rangeDayId),
      }))
      .filter((item) => isQualificationDrill(item.drill))
      .sort((a, b) => dateValue(b.rangeDay?.date) - dateValue(a.rangeDay?.date));

    const failures = officerResults.filter((item) => item.result.passed === false);
    const passed = officerResults.filter(
      (item) => item.result.passed === true || item.result.completed === true,
    );

    const day = passed.find(
      (item) =>
        Number(item.result.runNumber) === 1 &&
        !isLowLight(item.drill, item.result),
    );

    const night =
      passed.find((item) => Number(item.result.runNumber) === 2) ??
      passed.find((item) => isLowLight(item.drill, item.result));

    let status = "Current";
    let trend: Trend = "Stable";
    let detail = "Day and night qualification records are present.";
    let dayNightGap = "Low";

    if (failures.length > 0) {
      status = "Failed";
      trend = "Action Needed";
      detail = "Most recent qualification data includes a failed result.";
    } else if (!day && !night) {
      status = "No Record";
      trend = "Action Needed";
      detail = "No qualification record found in saved range data.";
    } else if (!day || !night) {
      status = "Missing Night";
      trend = "Monitor";
      detail = !night
        ? "Day qualification exists, but no night qualification is recorded."
        : "Night qualification exists, but no day qualification is recorded.";
      dayNightGap = "High";
    }

    const dayScore = scoreValue(day?.result);
    const nightScore = scoreValue(night?.result);
    if (dayScore !== undefined && nightScore !== undefined) {
      const gap = Math.abs(dayScore - nightScore);
      dayNightGap = gap >= 10 ? "High" : gap >= 5 ? "Moderate" : "Low";
    }

    const risk = getRiskFromStatus(status);

    return {
      officerId,
      name: label.name,
      assignment: label.assignment,
      status,
      dayScore: dayScore !== undefined ? String(dayScore) : "Missing",
      nightScore: nightScore !== undefined ? String(nightScore) : "Missing",
      trend,
      dayNightGap,
      lastQualified: formatDate((day ?? night)?.rangeDay?.date),
      risk,
      detail,
    };
  });

  const drillGroups = new Map<string, any[]>();

  workspace.results.forEach((result) => {
    const drill = drillById.get(result.drillId);
    if (!drill || isQualificationDrill(drill)) return;

    const key = `${result.officerId}::${drill.category ?? "Other"}`;
    const rangeDay = rangeDayById.get(result.rangeDayId);
    const current = drillGroups.get(key) ?? [];
    current.push({ result, drill, rangeDay });
    drillGroups.set(key, current);
  });

  const drillTrends = Array.from(drillGroups.entries()).map(([key, items]) => {
    const [officerId, category] = key.split("::");
    const label = getOfficerLabel(officerId);

    const sorted = [...items].sort(
      (a, b) => dateValue(a.rangeDay?.date) - dateValue(b.rangeDay?.date),
    );

    const scored = sorted
      .map((item) => scoreValue(item.result))
      .filter((value): value is number => value !== undefined);

    const first = scored[0] ?? 0;
    const last = scored[scored.length - 1] ?? first;
    const change = scored.length >= 2 ? last - first : 0;
    const trend = getTrendFromChange(change);
    const deficiencies = sorted.filter(
      (item) =>
        item.result.deficiencyObserved === true ||
        item.result.remedialTrainingRecommended === true ||
        item.result.passed === false,
    ).length;

    const risk: Risk =
      trend === "Action Needed" || deficiencies >= 2
        ? "High"
        : trend === "Declining" || deficiencies === 1
          ? "Medium"
          : "Low";

    return {
      officerId,
      name: label.name,
      assignment: label.assignment,
      category,
      trend,
      averageChange: change === 0 ? "0" : `${change > 0 ? "+" : ""}${change.toFixed(1)}`,
      weakArea: category,
      repeatedDeficiency: deficiencies >= 2 ? "Yes" : deficiencies === 1 ? "Monitor" : "No",
      remedial: sorted.some((item) => item.result.remedialTrainingRecommended)
        ? "Recommended"
        : "None",
      risk,
      detail:
        scored.length >= 2
          ? `Score changed from ${first} to ${last} across ${scored.length} recorded drill runs.`
          : `${sorted.length} recorded drill run${sorted.length === 1 ? "" : "s"} in this category.`,
    };
  });

  const broadCategoryTrends = Array.from(
    drillTrends.reduce((map, row) => {
      const current = map.get(row.category) ?? {
        category: row.category,
        affected: new Set<string>(),
        highRisk: 0,
        mediumRisk: 0,
        improving: 0,
        declining: 0,
      };

      current.affected.add(row.officerId);
      if (row.risk === "High") current.highRisk += 1;
      if (row.risk === "Medium") current.mediumRisk += 1;
      if (row.trend === "Improving") current.improving += 1;
      if (row.trend === "Declining" || row.trend === "Action Needed") current.declining += 1;

      map.set(row.category, current);
      return map;
    }, new Map<string, any>()).values(),
  ).map((item) => {
    const affectedCount = item.affected.size;
    const direction =
      item.highRisk > 0 || item.declining > item.improving
        ? "Monitor"
        : item.improving > item.declining
          ? "Improving"
          : "Stable";

    return {
      category: item.category,
      direction,
      affected: `${affectedCount} officer${affectedCount === 1 ? "" : "s"}`,
      detail:
        item.highRisk > 0
          ? `${item.highRisk} high-risk officer trend${item.highRisk === 1 ? "" : "s"} found in this category.`
          : `Category is based on ${affectedCount} officer performance record${affectedCount === 1 ? "" : "s"}.`,
    };
  });

  const alerts: any[] = [];

  qualificationTrends.forEach((row) => {
    if (row.risk === "Low") return;

    alerts.push({
      id: `pilot-alert-qualification-${row.officerId}`,
      officerName: row.name,
      officerAssignment: row.assignment,
      source: "Qualification",
      category: "Qualification Compliance",
      severity: row.risk,
      status: "New",
      title:
        row.status === "Failed"
          ? "Qualification failure requires review"
          : row.status === "Missing Night"
            ? "Missing day/night qualification record"
            : "Qualification record requires review",
      basis: row.detail,
      recommendedAction:
        row.status === "Missing Night"
          ? "Schedule the officer for the missing qualification condition and document completion."
          : "Review the qualification record and determine whether remediation or command notification is required.",
      createdAt: new Date().toISOString().slice(0, 10),
      recipients:
        row.risk === "High"
          ? ["Range Master", "Firearms Instructors", "Training Supervisor", "Command Staff"]
          : ["Range Master", "Firearms Instructors", "Training Supervisor"],
      relatedRecords: ["Qualification History", "Range Day Workspace"],
      auditLog: ["Generated from saved pilot range workspace."],
    });
  });

  drillTrends.forEach((row) => {
    if (row.risk === "Low") return;

    alerts.push({
      id: `pilot-alert-drill-${row.officerId}-${row.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      officerName: row.name,
      officerAssignment: row.assignment,
      source: "Drill Trend",
      category: row.category,
      severity: row.risk,
      status: "New",
      title:
        row.risk === "High"
          ? "Repeated drill deficiency requires remediation"
          : "Drill performance trend requires review",
      basis: `${row.detail} Repeated deficiency: ${row.repeatedDeficiency}.`,
      recommendedAction:
        row.risk === "High"
          ? "Create a remediation record and require documented follow-up training."
          : "Instructor should review the drill category during the next range block.",
      createdAt: new Date().toISOString().slice(0, 10),
      recipients:
        row.risk === "High"
          ? ["Range Master", "Firearms Instructors", "Training Supervisor", "Command Staff"]
          : ["Range Master", "Firearms Instructors", "Training Supervisor"],
      relatedRecords: ["Range Day Drill Results", "Instructor Notes"],
      auditLog: ["Generated from saved pilot drill results."],
    });
  });

  const currentQualifications = qualificationTrends.filter((row) => row.status === "Current").length;
  const totalQualificationRows = Math.max(qualificationTrends.length, 1);
  const qualificationCoverage = Math.round((currentQualifications / totalQualificationRows) * 100);

  const changes = drillTrends
    .map((row) => Number(String(row.averageChange).replace("+", "")))
    .filter((value) => Number.isFinite(value));
  const averageChange =
    changes.length > 0
      ? changes.reduce((sum, value) => sum + value, 0) / changes.length
      : 0;

  return {
    source: "pilot_range_workspaces",
    generatedAt: new Date().toISOString(),
    metrics: {
      qualificationCoverage: `${qualificationCoverage}%`,
      drillPerformance: `${averageChange > 0 ? "+" : ""}${averageChange.toFixed(1)}`,
      trainingFollowUps: String(alerts.filter((alert) => alert.source === "Drill Trend").length),
      officerWatchlist: String(
        new Set(
          [
            ...qualificationTrends.filter((row) => row.risk !== "Low").map((row) => row.officerId),
            ...drillTrends.filter((row) => row.risk !== "Low").map((row) => row.officerId),
          ],
        ).size,
      ),
    },
    qualificationTrends,
    drillTrends,
    broadCategoryTrends,
    trainingAlerts: alerts,
    hasWorkspaceData:
      workspace.rangeDays.length > 0 ||
      workspace.rangeRoster.length > 0 ||
      workspace.results.length > 0,
  };
}

export async function GET() {
  const { user, error: authError } = await getCurrentUser();

  if (authError || !user) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const departmentId = await getActiveDepartmentId(admin, user.id);

    if (!departmentId) {
      return NextResponse.json(
        { error: "No active department membership found." },
        { status: 404 },
      );
    }

    const { data, error } = await admin
      .from("pilot_range_workspaces")
      .select("workspace, updated_at")
      .eq("department_id", departmentId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const workspace = normalizeWorkspace(data?.workspace);
    const summary = buildPerformanceSummary(workspace);

    return NextResponse.json({
      ...summary,
      workspaceUpdatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to build pilot performance summary.",
      },
      { status: 500 },
    );
  }
}
