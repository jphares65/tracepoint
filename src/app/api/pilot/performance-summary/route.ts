import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type Risk = "Low" | "Medium" | "High";

type Trend =
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
  if (change <= -5) return "Action Needed";
  if (change < -1) return "Declining";
  if (change >= 5) return "Improving";
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

async function getPersonnelLabels(
  admin: any,
  departmentId: string,
): Promise<OfficerLabelMap> {
  const { data: memberships, error: membershipError } = await admin
    .from("department_memberships")
    .select("user_id, badge_number, rank_title, unit_name, is_active")
    .eq("department_id", departmentId)
    .eq("is_active", true);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const safeMemberships = Array.isArray(memberships)
    ? memberships
    : [];

  const userIds = safeMemberships
    .map((membership: any) => membership.user_id)
    .filter(Boolean);

  if (userIds.length === 0) {
    return {};
  }

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const profilesById = new Map<string, any>();

  (profiles ?? []).forEach((profile: any) => {
    profilesById.set(profile.id, profile);
  });

  const labels: OfficerLabelMap = {};

  safeMemberships.forEach((membership: any) => {
    const profile = profilesById.get(membership.user_id);

    const fullName = String(
      profile?.full_name ??
        profile?.email ??
        membership.user_id,
    ).trim();

    const rankTitle = String(
      membership.rank_title ?? "",
    ).trim();

    const displayName =
      rankTitle &&
      !fullName
        .toLowerCase()
        .startsWith(`${rankTitle.toLowerCase()} `)
        ? `${rankTitle} ${fullName}`
        : fullName;

    labels[membership.user_id] = {
      name: displayName,
      assignment:
        String(membership.unit_name ?? "").trim() ||
        "Department Personnel",
    };
  });

  return labels;
}

function buildQualificationTrends(
  officerLabels: OfficerLabelMap,
  qualificationResults: QualificationRow[],
) {
  return Object.keys(officerLabels).map((officerId) => {
    const label = officerLabels[officerId];

    const officerResults = qualificationResults
      .filter((row) => row.officer_user_id === officerId)
      .sort(
        (a, b) =>
          dateValue(a.qualification_date) -
          dateValue(b.qualification_date),
      );

    const latest = getLatest(officerResults);

    const latestDay = getLatest(
      officerResults,
      (row) =>
        row.lighting_condition === "day" ||
        row.lighting_condition === "not_applicable",
    );

    const latestNight = getLatest(
      officerResults,
      (row) =>
        row.lighting_condition === "night" ||
        row.lighting_condition === "low_light",
    );

    const status = qualificationStatus(latest);

    const passedScores = officerResults
      .filter((row) => row.passed)
      .map((row) => numericValue(row.score))
      .filter(
        (value): value is number =>
          value !== undefined,
      );

    const firstScore = passedScores[0];
    const lastScore =
      passedScores.length > 0
        ? passedScores[passedScores.length - 1]
        : undefined;

    const change =
      firstScore !== undefined &&
      lastScore !== undefined &&
      passedScores.length >= 2
        ? lastScore - firstScore
        : 0;

    let trend = getTrendFromChange(change);

    if (
      status === "Failed" ||
      status === "Expired" ||
      status === "No Record"
    ) {
      trend = "Action Needed";
    } else if (status === "Due Soon") {
      trend = "Monitor";
    }

    const dayScore = numericValue(latestDay?.score);
    const nightScore = numericValue(latestNight?.score);

    let dayNightGap = "N/A";

    if (
      dayScore !== undefined &&
      nightScore !== undefined
    ) {
      const gap = Math.abs(dayScore - nightScore);

      dayNightGap =
        gap >= 10
          ? "High"
          : gap >= 5
            ? "Moderate"
            : "Low";
    }

    const risk = getRiskFromQualificationStatus(status);

    let detail = "Current qualification record is on file.";

    if (status === "No Record") {
      detail = "No qualification result is recorded.";
    } else if (status === "Failed") {
      detail =
        "Most recent qualification result is a failure and requires review.";
    } else if (status === "Expired") {
      detail =
        "Most recent qualification has expired.";
    } else if (status === "Due Soon") {
      detail =
        "Qualification is current but approaching expiration.";
    } else if (passedScores.length >= 2) {
      detail = `Qualification score changed from ${firstScore} to ${lastScore} across ${passedScores.length} recorded results.`;
    }

    return {
      officerId,
      name: label.name,
      assignment: label.assignment,
      status,
      dayScore:
        dayScore !== undefined
          ? String(dayScore)
          : latest
            ? String(latest.score)
            : "Missing",
      nightScore:
        nightScore !== undefined
          ? String(nightScore)
          : "N/A",
      trend,
      dayNightGap,
      lastQualified: formatDate(
        latest?.qualification_date,
      ),
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
  const drillById = new Map(
    drills.map((drill) => [drill.id, drill]),
  );

  const rangeDayById = new Map(
    rangeDays.map((rangeDay) => [
      rangeDay.id,
      rangeDay,
    ]),
  );

  const groups = new Map<string, any[]>();

  drillResults.forEach((result) => {
    const drill = drillById.get(
      result.range_day_drill_id,
    );

    if (!drill) return;

    const key = `${result.officer_user_id}::${drill.category}`;

    const current = groups.get(key) ?? [];

    current.push({
      result,
      drill,
      rangeDay: rangeDayById.get(
        result.range_day_id,
      ),
    });

    groups.set(key, current);
  });

  return Array.from(groups.entries()).map(
    ([key, items]) => {
      const [officerId, category] =
        key.split("::");

      const label =
        officerLabels[officerId] ?? {
          name: officerId,
          assignment: "Department Personnel",
        };

      const sorted = [...items].sort(
        (a, b) =>
          dateValue(a.rangeDay?.range_date) -
          dateValue(b.rangeDay?.range_date),
      );

      const scored = sorted
        .map((item) =>
          numericValue(item.result.score),
        )
        .filter(
          (value): value is number =>
            value !== undefined,
        );

      const timed = sorted
        .map((item) =>
          numericValue(item.result.time_seconds),
        )
        .filter(
          (value): value is number =>
            value !== undefined,
        );

      let change = 0;
      let detail = `${sorted.length} recorded drill run${
        sorted.length === 1 ? "" : "s"
      } in this category.`;

      if (scored.length >= 2) {
        const first = scored[0];
        const last = scored[scored.length - 1];

        change = last - first;

        detail = `Score changed from ${first} to ${last} across ${scored.length} recorded drill runs.`;
      } else if (timed.length >= 2) {
        const first = timed[0];
        const last = timed[timed.length - 1];

        // For timed drills, a lower time is improvement.
        change = first - last;

        detail = `Time improved from ${first.toFixed(
          2,
        )}s to ${last.toFixed(
          2,
        )}s across ${timed.length} recorded runs.`;
      }

      const trend = getTrendFromChange(change);

      const deficiencies = sorted.filter(
        (item) =>
          item.result.deficiency_observed === true ||
          item.result
            .remedial_training_recommended === true ||
          item.result.passed === false,
      ).length;

      const risk: Risk =
        trend === "Action Needed" ||
        deficiencies >= 2
          ? "High"
          : trend === "Declining" ||
              deficiencies === 1
            ? "Medium"
            : "Low";

      return {
        officerId,
        name: label.name,
        assignment: label.assignment,
        category,
        trend,
        averageChange:
          change === 0
            ? "0"
            : `${
                change > 0 ? "+" : ""
              }${change.toFixed(1)}`,
        weakArea: category,
        repeatedDeficiency:
          deficiencies >= 2
            ? "Yes"
            : deficiencies === 1
              ? "Monitor"
              : "No",
        remedial: sorted.some(
          (item) =>
            item.result
              .remedial_training_recommended,
        )
          ? "Recommended"
          : "None",
        risk,
        detail,
      };
    },
  );
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
    const [
      personnelLabels,
      qualificationQuery,
      rangeDayQuery,
      drillQuery,
      resultQuery,
    ] = await Promise.all([
      getPersonnelLabels(admin, departmentId),

      admin
        .from("qualification_results")
        .select(
          "id, officer_user_id, qualification_date, lighting_condition, score, passed, expires_on, notes",
        )
        .eq("department_id", departmentId),

      admin
        .from("range_days")
        .select(
          "id, title, range_date, status, range_type",
        )
        .eq("department_id", departmentId),

      admin
        .from("range_day_drills")
        .select(
          "id, range_day_id, name, category, scoring_format, passing_score, max_score, passing_time_seconds",
        )
        .eq("department_id", departmentId),

      admin
        .from("drill_run_results")
        .select(
          "id, range_day_id, range_day_drill_id, officer_user_id, run_number, scoring_format_snapshot, completed, score, time_seconds, hit_count, passed, notes, deficiency_observed, remedial_training_recommended, recorded_at",
        )
        .eq("department_id", departmentId)
        .eq("completed", true),
    ]);

    if (qualificationQuery.error) {
      throw new Error(
        qualificationQuery.error.message,
      );
    }

    if (rangeDayQuery.error) {
      throw new Error(
        rangeDayQuery.error.message,
      );
    }

    if (drillQuery.error) {
      throw new Error(drillQuery.error.message);
    }

    if (resultQuery.error) {
      throw new Error(
        resultQuery.error.message,
      );
    }

    const qualificationResults =
      (qualificationQuery.data ??
        []) as QualificationRow[];

    const rangeDays =
      (rangeDayQuery.data ??
        []) as RangeDayRow[];

    const drills =
      (drillQuery.data ??
        []) as RangeDayDrillRow[];

    const drillResults =
      (resultQuery.data ??
        []) as DrillResultRow[];

    const rosterQuery = await admin
      .from("range_day_roster")
      .select("id, range_day_id, officer_user_id, attendance_status")
      .eq("department_id", departmentId);

    if (rosterQuery.error) {
      throw new Error(rosterQuery.error.message);
    }

    const rangeRoster = rosterQuery.data ?? [];
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
      .map((row) =>
        Number(
          String(row.averageChange).replace(
            "+",
            "",
          ),
        ),
      )
      .filter((value) =>
        Number.isFinite(value),
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
        location: day.location,
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
