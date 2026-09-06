type WorkspaceRecord = Record<string, unknown>;

export type RangeWorkspaceMutationDecision =
  | { ok: true; mode: "manage" | "score" }
  | { ok: false; status: 403 | 409; error: string };

const MANAGE_PERMISSION = "manage_range_days";
const SCORE_PERMISSIONS = new Set(["score_range_days", "manage_qualifications"]);
const FINAL_STATUSES = new Set(["completed", "locked", "archived"]);

function record(value: unknown): WorkspaceRecord {
  return value && typeof value === "object" ? value as WorkspaceRecord : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is WorkspaceRecord => Boolean(item) && typeof item === "object")
    : [];
}

function collection(workspace: WorkspaceRecord, camel: string, snake: string) {
  return records(workspace[camel] ?? workspace[snake]);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function field(item: WorkspaceRecord, camel: string, snake: string) {
  return text(item[camel] ?? item[snake]);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as WorkspaceRecord;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stable(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown) {
  return stable(left) === stable(right);
}

function relatedToRangeDay(items: WorkspaceRecord[], rangeDayId: string) {
  return items.filter((item) => field(item, "rangeDayId", "range_day_id") === rangeDayId);
}

function isFinalized(rangeDay: WorkspaceRecord) {
  return FINAL_STATUSES.has(text(rangeDay.status).toLowerCase()) ||
    field(rangeDay, "packetStatus", "packet_status").toLowerCase() === "ready";
}

function validateTenantReferences(workspace: WorkspaceRecord, departmentId: string) {
  const rangeDays = collection(workspace, "rangeDays", "range_days");
  const library = collection(workspace, "drillLibrary", "drill_library");
  const rangeDayIds = new Set(rangeDays.map((item) => text(item.id)).filter(Boolean));

  const explicitlyCrossTenant = [...rangeDays, ...library].some((item) => {
    const owner = field(item, "departmentId", "department_id");
    return Boolean(owner) && owner !== departmentId;
  });
  if (explicitlyCrossTenant) return false;

  return [
    ...collection(workspace, "rangeDayDrills", "range_day_drills"),
    ...collection(workspace, "rangeRoster", "range_roster"),
    ...collection(workspace, "results", "drill_run_results"),
    ...collection(workspace, "malfunctions", "firearm_malfunctions"),
  ].every((item) => {
    const rangeDayId = field(item, "rangeDayId", "range_day_id");
    return !rangeDayId || rangeDayIds.has(rangeDayId);
  });
}

function finalizedHistoryChanged(existing: WorkspaceRecord, next: WorkspaceRecord) {
  const existingDays = collection(existing, "rangeDays", "range_days");
  const nextDays = collection(next, "rangeDays", "range_days");
  const collectionPairs = [
    ["rangeDayDrills", "range_day_drills"],
    ["rangeRoster", "range_roster"],
    ["results", "drill_run_results"],
    ["malfunctions", "firearm_malfunctions"],
  ] as const;

  return existingDays.filter(isFinalized).some((existingDay) => {
    const id = text(existingDay.id);
    const nextDay = nextDays.find((item) => text(item.id) === id);
    if (!nextDay || !same(existingDay, nextDay)) return true;

    return collectionPairs.some(([camel, snake]) => !same(
      relatedToRangeDay(collection(existing, camel, snake), id),
      relatedToRangeDay(collection(next, camel, snake), id),
    ));
  });
}

export function authorizeRangeWorkspaceMutation(input: {
  existingWorkspace: unknown;
  nextWorkspace: unknown;
  departmentId: string;
  permissions: readonly string[];
}): RangeWorkspaceMutationDecision {
  const existing = record(input.existingWorkspace);
  const next = record(input.nextWorkspace);
  const canManage = input.permissions.includes("administer_department") ||
    input.permissions.includes(MANAGE_PERMISSION);
  const canScore = canManage || input.permissions.some((permission) => SCORE_PERMISSIONS.has(permission));

  if (!canScore) {
    return { ok: false, status: 403, error: "You do not have permission to update range records." };
  }
  if (!validateTenantReferences(next, input.departmentId)) {
    return { ok: false, status: 403, error: "The range workspace contains records outside your agency." };
  }
  if (finalizedHistoryChanged(existing, next)) {
    return { ok: false, status: 409, error: "Completed, locked, archived, or finalized range records cannot be changed." };
  }

  if (!canManage) {
    const protectedCollections = [
      ["rangeDays", "range_days"],
      ["drillLibrary", "drill_library"],
      ["rangeDayDrills", "range_day_drills"],
      ["rangeRoster", "range_roster"],
    ] as const;
    const planningChanged = protectedCollections.some(([camel, snake]) =>
      !same(collection(existing, camel, snake), collection(next, camel, snake)),
    );
    if (planningChanged) {
      return { ok: false, status: 403, error: "Range-day planning and drill-library changes require range management permission." };
    }
  }

  return { ok: true, mode: canManage ? "manage" : "score" };
}
