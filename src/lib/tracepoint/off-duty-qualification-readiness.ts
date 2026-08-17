import {
  evaluateQualificationReadiness,
  type QualificationReadinessEvent,
} from "@/lib/tracepoint/qualification-readiness";

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function valueOf(row: any, ...keys: string[]) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key];
    }
  }

  return undefined;
}

function dateValue(value?: string | null) {
  if (!value) return 0;

  const parsed = value.includes("T")
    ? new Date(value).getTime()
    : new Date(`${value}T00:00:00`).getTime();

  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function getOfficerQualificationReadiness(
  context: any,
  officerUserId: string,
) {
  const [workspaceResult, rulesResult] = await Promise.all([
    context.admin
      .from("pilot_range_workspaces")
      .select("workspace")
      .eq("department_id", context.departmentId)
      .maybeSingle(),

    context.admin
      .from("department_rules")
      .select(
        "qualification_valid_days,qualification_due_soon_days",
      )
      .eq("department_id", context.departmentId)
      .maybeSingle(),
  ]);

  if (workspaceResult.error) {
    throw new Error(workspaceResult.error.message);
  }

  if (rulesResult.error) {
    throw new Error(rulesResult.error.message);
  }

  const workspace =
    workspaceResult.data?.workspace &&
    typeof workspaceResult.data.workspace === "object"
      ? workspaceResult.data.workspace
      : {};

  const rangeDays = Array.isArray(workspace.rangeDays)
    ? workspace.rangeDays
    : [];

  const drills = Array.isArray(workspace.rangeDayDrills)
    ? workspace.rangeDayDrills
    : [];

  const results = Array.isArray(workspace.results)
    ? workspace.results
    : [];

  const rangeDaysById = new Map(
    rangeDays.map((day: any) => [
      String(valueOf(day, "id")),
      day,
    ]),
  );

  const drillsById = new Map(
    drills.map((drill: any) => [
      String(valueOf(drill, "id")),
      drill,
    ]),
  );

  const qualificationResults = results
    .filter((result: any) => {
      const resultOfficerId = String(
        valueOf(result, "officerId", "officer_id") ?? "",
      );

      if (resultOfficerId !== officerUserId) {
        return false;
      }

      const drillId = String(
        valueOf(result, "drillId", "drill_id") ?? "",
      );

      const drill = drillsById.get(drillId) as any;

      if (!drill) {
        return false;
      }

      const name = String(
        valueOf(drill, "name") ?? "",
      ).toLowerCase();

      const category = String(
        valueOf(drill, "category") ?? "",
      ).toLowerCase();

      const firearmType = String(
        valueOf(drill, "firearmType", "firearm_type") ?? "",
      ).toLowerCase();

      const isQualification =
        category === "qualification" ||
        name.includes("qualification");

      const isRifle =
        name.includes("rifle") ||
        category.includes("rifle") ||
        firearmType.includes("rifle");

      return isQualification && !isRifle;
    })
    .map((result: any) => {
      const rangeDayId = String(
        valueOf(result, "rangeDayId", "range_day_id") ?? "",
      );

      const rangeDay = rangeDaysById.get(rangeDayId) as any;

      const date = cleanText(
        valueOf(
          rangeDay,
          "date",
          "scheduledDate",
          "scheduled_date",
          "rangeDate",
          "range_date",
        ),
      );

      const runNumber = Number(
        valueOf(result, "runNumber", "run_number") ?? 1,
      );

      const passedValue = valueOf(result, "passed");

      const passed =
        typeof passedValue === "boolean"
          ? passedValue
          : valueOf(result, "completed") === true;

      return {
        date: date ?? "",
        runNumber,
        passed,
      };
    })
    .filter((result: any) => Boolean(result.date))
    .sort(
      (left: any, right: any) =>
        dateValue(right.date) - dateValue(left.date),
    );

  const passedResults = qualificationResults.filter(
    (result: any) => result.passed,
  );

  const lastDay = passedResults.find(
    (result: any) => result.runNumber === 1,
  );

  const lastNight = passedResults.find(
    (result: any) => result.runNumber === 2,
  );

  const failedQualifications: QualificationReadinessEvent[] =
    qualificationResults
      .filter((result: any) => result.passed === false)
      .map((result: any) => ({
        date: result.date,
        runLabel:
          result.runNumber === 2
            ? "Night qualification"
            : "Day qualification",
      }));

  const qualificationValidDays =
    Number(rulesResult.data?.qualification_valid_days) || 365;

  const rawDueSoonDays =
    rulesResult.data?.qualification_due_soon_days;

  const qualificationDueSoonDays =
    rawDueSoonDays === null || rawDueSoonDays === undefined
      ? 30
      : Number(rawDueSoonDays);

  return evaluateQualificationReadiness({
    lastDayQualification: lastDay
      ? {
          date: lastDay.date,
          runLabel: "Day qualification",
        }
      : undefined,

    lastNightQualification: lastNight
      ? {
          date: lastNight.date,
          runLabel: "Night qualification",
        }
      : undefined,

    failedQualifications,
    qualificationValidDays,
    qualificationDueSoonDays,
  });
}
