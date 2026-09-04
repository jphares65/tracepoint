type WorkspaceRecord = Record<string, unknown>;

export type RangeDrillRemovalResult =
  | { ok: true; workspace: WorkspaceRecord; drillName: string }
  | { ok: false; status: 404 | 409; error: string };

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const records = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is WorkspaceRecord => Boolean(item) && typeof item === "object")
  : [];

export function removeRangeDayDrill(
  workspaceValue: unknown,
  input: { rangeDayId: string; drillId: string; departmentId: string },
): RangeDrillRemovalResult {
  const workspace = workspaceValue && typeof workspaceValue === "object"
    ? workspaceValue as WorkspaceRecord
    : {};
  const rangeDays = records(workspace.rangeDays);
  const drills = records(workspace.rangeDayDrills);
  const results = records(workspace.results);
  const malfunctions = records(workspace.malfunctions);
  const rangeDay = rangeDays.find((day) =>
    text(day.id) === input.rangeDayId && text(day.departmentId) === input.departmentId,
  );

  if (!rangeDay) {
    return { ok: false, status: 404, error: "Range day was not found in your agency." };
  }

  const drill = drills.find((item) =>
    text(item.id) === input.drillId && text(item.rangeDayId) === input.rangeDayId,
  );
  if (!drill) {
    return { ok: false, status: 404, error: "Drill was not found on this range day." };
  }

  const status = text(rangeDay.status).toLowerCase();
  const packetStatus = text(rangeDay.packetStatus).toLowerCase();
  if (["completed", "locked", "archived"].includes(status) || packetStatus === "ready") {
    return {
      ok: false,
      status: 409,
      error: "This drill cannot be removed because the range day or packet is finalized or locked. Historical records must remain unchanged.",
    };
  }

  const dependentResults = results.filter((result) =>
    text(result.rangeDayId) === input.rangeDayId && text(result.drillId) === input.drillId,
  );
  const resultIds = new Set(dependentResults.map((result) => text(result.id)).filter(Boolean));
  const hasMalfunction = malfunctions.some((item) =>
    text(item.rangeDayId) === input.rangeDayId &&
    (text(item.drillId) === input.drillId ||
      resultIds.has(text(item.drillRunId)) ||
      resultIds.has(text(item.drillRunResultId))),
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
    workspace: {
      ...workspace,
      rangeDayDrills: drills.filter((item) => item !== drill),
    },
  };
}
