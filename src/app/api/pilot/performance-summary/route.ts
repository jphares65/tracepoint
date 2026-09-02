import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";

type Risk = "Low" | "Medium" | "High";

type Trend =
  | "Baseline"
  | "Improving"
  | "Stable"
  | "Monitor"
  | "Declining"
  | "Action Needed";

type OfficerLabelMap = Record<
  string,
  {
    name: string;
    assignment: string;
  }
>;

type QualificationRow = {
  id: string;
  officer_user_id: string;
  qualification_date: string;
  lighting_condition: string;
  score: number | string;
  passed: boolean;
  expires_on: string | null;
  notes: string | null;
};

type DrillResultRow = {
  id: string;
  range_day_id: string;
  range_day_drill_id: string;
  officer_user_id: string;
  run_number: number;
  scoring_format_snapshot: string;
  completed: boolean;
  score: number | string | null;
  time_seconds: number | string | null;
  hit_count: number | null;
  passed: boolean | null;
  notes: string | null;
  deficiency_observed: boolean;
  remedial_training_recommended: boolean;
  recorded_at: string;
};

type RangeDayRow = {
  id: string;
  title: string;
  range_date: string;
  status: string;
  range_type: string;
  packet_status: string;
};

type RangeDayDrillRow = {
  id: string;
  range_day_id: string;
  name: string;
  category: string;
  scoring_format: string;
  passing_score: number | string | null;
  max_score: number | string | null;
  passing_time_seconds: number | string | null;
};

function dateValue(value?: string | null) {
  if (!value) return 0;

  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(value?: string | null) {
  if (!value) return "Missing";

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function numericValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function getTrendFromChange(change: number): Trend {
  if (change < -1) return "Declining";
  if (change > 1) return "Improving";
  return "Stable";
}

function getRiskFromQualificationStatus(status: string): Risk {
  if (
    status === "Failed" ||
    status === "Expired" ||
    status === "No Record"
  ) {
    return "High";
  }

  if (status === "Due Soon") {
    return "Medium";
  }

  return "Low";
}

function getLatest(
  rows: QualificationRow[],
  predicate?: (row: QualificationRow) => boolean,
) {
  return [...rows]
    .filter((row) => (predicate ? predicate(row) : true))
    .sort(
      (a, b) =>
        dateValue(b.qualification_date) -
        dateValue(a.qualification_date),
    )[0];
}

function qualificationStatus(latest?: QualificationRow) {
  if (!latest) return "No Record";

  if (!latest.passed) {
    return "Failed";
  }

  if (!latest.expires_on) {
    return "Current";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiration = new Date(`${latest.expires_on}T00:00:00`);

  if (expiration.getTime() < today.getTime()) {
    return "Expired";
  }

  const dueSoon = new Date(today);
  dueSoon.setDate(dueSoon.getDate() + 30);

  if (expiration.getTime() <= dueSoon.getTime()) {
    return "Due Soon";
  }

  return "Current";
}

function buildQualificationTrends(
  officerLabels: OfficerLabelMap,
  qualificationResults: QualificationRow[],
) {
  return Object.keys(officerLabels).map((officerId) => {
    const label = officerLabels[officerId];
    const officerResults = qualificationResults
      .filter((row) => row.officer_user_id === officerId)
      .sort((a, b) => dateValue(a.qualification_date) - dateValue(b.qualification_date));

    const latest = getLatest(officerResults);
    const dayResults = officerResults.filter(
      (row) => row.lighting_condition === "day" || row.lighting_condition === "not_applicable",
    );
    const nightResults = officerResults.filter(
      (row) => row.lighting_condition === "night" || row.lighting_condition === "low_light",
    );
    const latestDay = getLatest(dayResults);
    const latestNight = getLatest(nightResults);

    const componentStatuses = [latestDay, latestNight]
      .filter((row): row is QualificationRow => Boolean(row))
      .map(qualificationStatus);
    const status = componentStatuses.includes("Failed")
      ? "Failed"
      : componentStatuses.includes("Expired")
        ? "Expired"
        : componentStatuses.includes("Due Soon")
          ? "Due Soon"
          : componentStatuses.includes("Current")
            ? "Current"
            : "No Record";

    const comparisons: Array<{
      component: string;
      previous: number;
      current: number;
      change: number;
      trend: Trend;
    }> = [];

    for (const [component, rows] of [
      ["Day", dayResults],
      ["Night", nightResults],
    ] as const) {
      const scored = rows
        .map((row) => ({ row, score: numericValue(row.score) }))
        .filter((item): item is { row: QualificationRow; score: number } => item.score !== undefined);
      if (scored.length < 2) continue;
      const previous = scored[scored.length - 2].score;
      const current = scored[scored.length - 1].score;
      const change = current - previous;
      comparisons.push({ component, previous, current, change, trend: getTrendFromChange(change) });
    }

    let trend: Trend = "Baseline";
    if (status === "Failed" || status === "Expired" || status === "No Record") {
      trend = "Action Needed";
    } else if (status === "Due Soon") {
      trend = "Monitor";
    } else if (comparisons.length > 0) {
      const improving = comparisons.some((item) => item.trend === "Improving");
      const declining = comparisons.some((item) => item.trend === "Declining");
      trend = improving && declining
        ? "Monitor"
        : declining
          ? "Declining"
          : improving
            ? "Improving"
            : "Stable";
    }

    const dayScore = numericValue(latestDay?.score);
    const nightScore = numericValue(latestNight?.score);
    const coverage = latestDay && latestNight
      ? "Day + Night"
      : latestDay?.lighting_condition === "not_applicable"
        ? "Single Course"
        : latestDay
          ? "Day Only"
          : latestNight
            ? "Night Only"
            : "No Record";
    const risk = getRiskFromQualificationStatus(status);

    let detail = "Current qualification record is on file; additional same-component history is needed for a trend.";
    if (status === "No Record") detail = "No qualification result is recorded.";
    else if (status === "Failed") detail = "A most-recent qualification component is failed and requires review.";
    else if (status === "Expired") detail = "A most-recent qualification component has expired.";
    else if (status === "Due Soon") detail = "Qualification is current but approaching expiration.";
    else if (comparisons.length > 0) {
      detail = comparisons
        .map((item) => `${item.component} changed from ${item.previous} to ${item.current}`)
        .join("; ") + ".";
    }

    return {
      officerId,
      name: label.name,
      assignment: label.assignment,
      status,
      dayScore: dayScore !== undefined ? String(dayScore) : latest && !latestNight ? String(latest.score) : "Missing",
      nightScore: nightScore !== undefined ? String(nightScore) : "N/A",
      trend,
      dayNightGap: coverage,
      lastQualified: formatDate(latest?.qualification_date),
      risk,
      detail,
    };
  });
}

function buildDrillTrends(
  officerLabels: OfficerLabelMap,
  drillResults: DrillResultRow[],
  drills: RangeDayDrillRow[],
  rangeDays: RangeDayRow[],
) {
  const drillById = new Map(drills.map((drill) => [drill.id, drill]));
  const rangeDayById = new Map(rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]));
  const groups = new Map<string, any[]>();

  drillResults.forEach((result) => {
    const drill = drillById.get(result.range_day_drill_id);
    if (!drill) return;
    const drillIdentity = `${drill.name.trim().toLowerCase()}::${drill.scoring_format}`;
    const key = `${result.officer_user_id}::${drill.category}::${drillIdentity}`;
    const current = groups.get(key) ?? [];
    current.push({ result, drill, rangeDay: rangeDayById.get(result.range_day_id) });
    groups.set(key, current);
  });

  return Array.from(groups.entries()).map(([key, items]) => {
    const [officerId, category] = key.split("::");
    const label = officerLabels[officerId] ?? { name: officerId, assignment: "Department Personnel" };
    const drillName = String(items[0]?.drill?.name ?? category);

    const latestByRangeDay = new Map<string, any>();
    for (const item of items) {
      const current = latestByRangeDay.get(item.result.range_day_id);
      const currentRun = Number(current?.result?.run_number ?? 0);
      const nextRun = Number(item.result.run_number ?? 0);
      if (!current || nextRun > currentRun || (nextRun === currentRun && String(item.result.recorded_at) > String(current.result.recorded_at))) {
        latestByRangeDay.set(item.result.range_day_id, item);
      }
    }
    const sorted = Array.from(latestByRangeDay.values()).sort(
      (a, b) => dateValue(a.rangeDay?.range_date) - dateValue(b.rangeDay?.range_date),
    );

    const scoreSeries = sorted
      .map((item) => {
        const score = numericValue(item.result.score);
        if (score === undefined) return null;
        const maximum = numericValue(item.drill.max_score);
        return { value: maximum && maximum > 0 ? (score / maximum) * 100 : score, normalized: Boolean(maximum && maximum > 0) };
      })
      .filter((item): item is { value: number; normalized: boolean } => item !== null);
    const timeSeries = sorted
      .map((item) => numericValue(item.result.time_seconds))
      .filter((value): value is number => value !== undefined);

    let change: number | null = null;
    let detail = `${sorted.length} range-day record${sorted.length === 1 ? "" : "s"} for ${drillName}; another comparable date is needed for a trend.`;
    if (scoreSeries.length >= 2) {
      const previous = scoreSeries[scoreSeries.length - 2];
      const current = scoreSeries[scoreSeries.length - 1];
      change = current.value - previous.value;
      detail = previous.normalized && current.normalized
        ? `Normalized score changed from ${previous.value.toFixed(1)}% to ${current.value.toFixed(1)}% across the two latest range days.`
        : `Score changed from ${previous.value} to ${current.value} across the two latest range days.`;
    } else if (timeSeries.length >= 2) {
      const previous = timeSeries[timeSeries.length - 2];
      const current = timeSeries[timeSeries.length - 1];
      change = previous - current;
      detail = `Time changed from ${previous.toFixed(2)}s to ${current.toFixed(2)}s across the two latest range days; lower is better.`;
    }

    let trend: Trend = change === null ? "Baseline" : getTrendFromChange(change);
    const latestResult = sorted[sorted.length - 1]?.result;
    const deficiencies = sorted.filter(
      (item) => item.result.deficiency_observed === true || item.result.remedial_training_recommended === true || item.result.passed === false,
    ).length;
    if (latestResult?.passed === false || latestResult?.remedial_training_recommended === true) trend = "Action Needed";

    const risk: Risk = trend === "Action Needed" || deficiencies >= 2
      ? "High"
      : trend === "Declining" || deficiencies === 1
        ? "Medium"
        : "Low";

    return {
      officerId,
      name: label.name,
      assignment: label.assignment,
      category,
      drillName,
      trend,
      changeValue: change,
      averageChange: change === null ? "â€”" : `${change > 0 ? "+" : ""}${change.toFixed(1)}`,
      weakArea: drillName,
      repeatedDeficiency: deficiencies >= 2 ? "Yes" : deficiencies === 1 ? "Monitor" : "No",
      remedial: sorted.some((item) => item.result.remedial_training_recommended) ? "Recommended" : "None",
      risk,
      detail,
    };
  });
}

function buildBroadCategoryTrends(
  drillTrends: any[],
) {
  return Array.from(
    drillTrends
      .reduce((map, row) => {
        const current =
          map.get(row.category) ?? {
            category: row.category,
            affected: new Set<string>(),
            highRisk: 0,
            mediumRisk: 0,
            improving: 0,
            declining: 0,
          };

        current.affected.add(row.officerId);

        if (row.risk === "High") {
          current.highRisk += 1;
        }

        if (row.risk === "Medium") {
          current.mediumRisk += 1;
        }

        if (row.trend === "Improving") {
          current.improving += 1;
        }

        if (
          row.trend === "Declining" ||
          row.trend === "Action Needed"
        ) {
          current.declining += 1;
        }

        map.set(row.category, current);
        return map;
      }, new Map<string, any>())
      .values(),
  ).map((item: any) => {
    const affectedCount = item.affected.size;

    const direction =
      item.highRisk > 0 ||
      item.declining > item.improving
        ? "Monitor"
        : item.improving > item.declining
          ? "Improving"
          : "Stable";

    return {
      category: item.category,
      direction,
      affected: `${affectedCount} officer${
        affectedCount === 1 ? "" : "s"
      }`,
      detail:
        item.highRisk > 0
          ? `${item.highRisk} high-risk officer trend${
              item.highRisk === 1 ? "" : "s"
            } found in this category.`
          : `Category is based on ${affectedCount} officer performance record${
              affectedCount === 1 ? "" : "s"
            }.`,
    };
  });
}

function buildAlerts(
  qualificationTrends: any[],
  drillTrends: any[],
) {
  const alerts: any[] = [];

  qualificationTrends.forEach((row) => {
    if (row.risk === "Low") return;

    alerts.push({
      id: `qualification-${row.officerId}`,
      officerName: row.name,
      officerAssignment: row.assignment,
      source: "Qualification",
      category: "Qualification Readiness",
      severity: row.risk,
      status: "New",
      title:
        row.status === "Failed"
          ? "Qualification failure requires review"
          : row.status === "Expired"
            ? "Qualification has expired"
            : row.status === "No Record"
              ? "Qualification record missing"
              : "Qualification renewal approaching",
      basis: row.detail,
      recommendedAction:
        row.status === "Due Soon"
          ? "Schedule the officer for the upcoming qualification cycle."
          : "Review the qualification record and determine appropriate follow-up.",
      createdAt: new Date()
        .toISOString()
        .slice(0, 10),
      recipients: [
        "Range Master",
        "Firearms Instructors",
        "Training Supervisor",
        ...(row.risk === "High"
          ? ["Command Staff"]
          : []),
      ],
      relatedRecords: [
        "Qualification History",
        "Range & Training",
      ],
      auditLog: [
        "Generated from authoritative qualification records.",
      ],
    });
  });

  drillTrends.forEach((row) => {
    if (row.risk === "Low") return;

    alerts.push({
      id: `drill-${row.officerId}-${row.category
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`,
      officerName: row.name,
      officerAssignment: row.assignment,
      source: "Drill Trend",
      category: row.category,
      severity: row.risk,
      status: "New",
      title:
        row.risk === "High"
          ? "Repeated drill deficiency requires remediation"
          : "Drill performance requires review",
      basis: `${row.detail} Repeated deficiency: ${row.repeatedDeficiency}.`,
      recommendedAction:
        row.risk === "High"
          ? "Create a remediation record and require documented follow-up training."
          : "Review this drill category during the next training block.",
      createdAt: new Date()
        .toISOString()
        .slice(0, 10),
      recipients: [
        "Range Master",
        "Firearms Instructors",
        "Training Supervisor",
        ...(row.risk === "High"
          ? ["Command Staff"]
          : []),
      ],
      relatedRecords: [
        "Range-Day Drill Results",
        "Instructor Notes",
      ],
      auditLog: [
        "Generated from authoritative drill results.",
      ],
    });
  });

  return alerts;
}

export async function GET() {
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

  const { admin, departmentId } =
    resolved.context;

  try {
    const inputs = await createRangeReadRepository(admin, departmentId).getPerformanceInputs(departmentId);
    const personnelLabels = inputs.personnelLabels as OfficerLabelMap;
    const qualificationResults = inputs.qualificationResults as QualificationRow[];
    const rangeDays = inputs.rangeDays as RangeDayRow[];
    const drills = inputs.drills as RangeDayDrillRow[];
    const drillResults = inputs.drillResults as DrillResultRow[];
    const rangeRoster = inputs.rangeRoster;
    const qualificationTrends =
      buildQualificationTrends(
        personnelLabels,
        qualificationResults,
      );

    const drillTrends = buildDrillTrends(
      personnelLabels,
      drillResults,
      drills,
      rangeDays,
    );

    const broadCategoryTrends =
      buildBroadCategoryTrends(drillTrends);

    const alerts = buildAlerts(
      qualificationTrends,
      drillTrends,
    );

    const currentQualifications =
      qualificationTrends.filter(
        (row) => row.status === "Current",
      ).length;

    const totalOfficers =
      qualificationTrends.length;

    const qualificationCoverage =
      totalOfficers > 0
        ? Math.round(
            (currentQualifications /
              totalOfficers) *
              100,
          )
        : 0;

    const changes = drillTrends
      .map((row) => row.changeValue)
      .filter((value): value is number =>
        typeof value === "number" && Number.isFinite(value),
      );

    const averageChange =
      changes.length > 0
        ? changes.reduce(
            (sum, value) => sum + value,
            0,
          ) / changes.length
        : 0;

    const today = new Date().toISOString().slice(0, 10);

    const activeRangeDays = rangeDays.filter(
      (day) => String(day.status).toLowerCase() !== "archived",
    );

    const upcomingRangeDays = activeRangeDays
      .filter(
        (day) =>
          String(day.range_date ?? "") >= today &&
          !["completed", "locked", "archived"].includes(
            String(day.status).toLowerCase(),
          ),
      )
      .sort((a, b) =>
        String(a.range_date).localeCompare(String(b.range_date)),
      )
      .slice(0, 4)
      .map((day) => ({
        id: day.id,
        title: day.title,
        date: day.range_date,
        status: day.status,
        packetStatus: day.packet_status,
        rangeType: day.range_type,
      }));

    const incompletePacketCount = activeRangeDays.filter(
      (day) =>
        !["completed", "locked"].includes(
          String(day.status).toLowerCase(),
        ) &&
        String(day.packet_status).toLowerCase() !== "ready",
    ).length;

    const rangeSummary = {
      totalRangeDays: rangeDays.length,
      activeRangeDays: activeRangeDays.length,
      upcomingRangeDayCount: upcomingRangeDays.length,
      incompletePacketCount,
      rosterAssignmentCount: rangeRoster.length,
      plannedDrillCount: drills.length,
      upcomingRangeDays,
    };
    return NextResponse.json({
      source: "authoritative_range_training",
      generatedAt: new Date().toISOString(),

      metrics: {
        qualificationCoverage: `${qualificationCoverage}%`,

        drillPerformance:
          drillResults.length === 0
            ? "—"
            : `${
                averageChange > 0 ? "+" : ""
              }${averageChange.toFixed(1)}`,

        trainingFollowUps: String(
          alerts.filter(
            (alert) =>
              alert.source === "Drill Trend",
          ).length,
        ),

        officerWatchlist: String(
          new Set(
            [
              ...qualificationTrends
                .filter(
                  (row) =>
                    row.risk !== "Low",
                )
                .map(
                  (row) => row.officerId,
                ),

              ...drillTrends
                .filter(
                  (row) =>
                    row.risk !== "Low",
                )
                .map(
                  (row) => row.officerId,
                ),
            ],
          ).size,
        ),
      },

      qualificationTrends,
      drillTrends,
      broadCategoryTrends,
      trainingAlerts: alerts,
      rangeSummary,

      hasWorkspaceData:
        rangeDays.length > 0 ||
        qualificationResults.length > 0 ||
        drillResults.length > 0,

      workspaceUpdatedAt: null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to build performance summary.",
      },
      { status: 500 },
    );
  }
}
