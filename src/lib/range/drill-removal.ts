type WorkspaceRecord = Record<string, unknown>;

export type RangeDrillRemovalResult =
  | { ok: true; workspace: WorkspaceRecord; drillName: string }
  | { ok: false; status: 404 | 409; error: string };

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const records = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is WorkspaceRecord => Boolean(item) && typeof item === "object")
  : [];
const collection = (workspace: WorkspaceRecord, camel: string, snake: string) =>
  records(workspace[camel] ?? workspace[snake]);
const field = (record: WorkspaceRecord, camel: string, snake: string) =>
  text(record[camel] ?? record[snake]);

export function removeRangeDayDrill(
  workspaceValue: unknown,
  input: { rangeDayId: string; drillId: string; departmentId: string },
): RangeDrillRemovalResult {
  const workspace = workspaceValue && typeof workspaceValue === "object"
    ? workspaceValue as WorkspaceRecord
    : {};
  const rangeDays = collection(workspace, "rangeDays", "range_days");
  const drills = collection(workspace, "rangeDayDrills", "range_day_drills");
  const results = collection(workspace, "results", "drill_run_results");
  const malfunctions = collection(workspace, "malfunctions", "firearm_malfunctions");
  const rangeDay = rangeDays.find((day) =>
    text(day.id) === input.rangeDayId,
  );

  if (!rangeDay) {
    return { ok: false, status: 404, error: "Range day was not found in your agency." };
  }

  const drill = drills.find((item) =>
    text(item.id) === input.drillId && field(item, "rangeDayId", "range_day_id") === input.rangeDayId,
  );
  if (!drill) {
    return { ok: false, status: 404, error: "Drill was not found on this range day." };
  }

  const status = text(rangeDay.status).toLowerCase();
  const packetStatus = field(rangeDay, "packetStatus", "packet_status").toLowerCase();
  if (["completed", "locked", "archived"].includes(status) || packetStatus === "ready") {
    return {
      ok: false,
      status: 409,
      error: "This drill cannot be removed because the range day or packet is finalized or locked. Historical records must remain unchanged.",
    };
  }

  const dependentResults = results.filter((result) =>
    field(result, "rangeDayId", "range_day_id") === input.rangeDayId &&
    [field(result, "drillId", "drill_id"), field(result, "rangeDayDrillId", "range_day_drill_id")].includes(input.drillId),
  );
  const resultIds = new Set(dependentResults.map((result) => text(result.id)).filter(Boolean));
  const hasMalfunction = malfunctions.some((item) =>
    field(item, "rangeDayId", "range_day_id") === input.rangeDayId &&
    (field(item, "drillId", "drill_id") === input.drillId ||
      resultIds.has(field(item, "drillRunId", "drill_run_id")) ||
      resultIds.has(field(item, "drillRunResultId", "drill_run_result_id"))),
  );
  if (dependentResults.length > 0 || hasMalfunction) {
    return {
      ok: false,
      status: 409,
      error: "This drill has saved scores, qualification results, malfunctions, or other dependent records and cannot be removed. Preserve it for audit history.",
    };
  }

  return {
    ok: true,
    drillName: text(drill.name) || "Drill",
    workspace: workspace.range_day_drills !== undefined && workspace.rangeDayDrills === undefined
      ? { ...workspace, range_day_drills: drills.filter((item) => item !== drill) }
      : { ...workspace, rangeDayDrills: drills.filter((item) => item !== drill) },
  };
}
