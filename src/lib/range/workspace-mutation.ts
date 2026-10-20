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

// Packet readiness is a planning milestone; only the day status finalizes history.
function isFinalized(rangeDay: WorkspaceRecord) {
  return FINAL_STATUSES.has(text(rangeDay.status).toLowerCase());
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

function part(item: WorkspaceRecord, ...keys: string[]) {
  const value = keys.map((key) => item[key]).find((candidate) => candidate !== undefined && candidate !== null);
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

// A saved result is identified for corrections by its range day, drill, run and officer.
function resultKey(item: WorkspaceRecord) {
  const parts = [
    part(item, "rangeDayId", "range_day_id"),
    part(item, "drillId", "drill_id", "rangeDayDrillId", "range_day_drill_id"),
    part(item, "runNumber", "run_number"),
    part(item, "officerId", "officer_id", "officerUserId", "officer_user_id"),
  ];
  return parts.every(Boolean) ? parts.join("|") : "";
}

function malfunctionResultId(item: WorkspaceRecord) {
  return part(item, "drillRunId", "drillRunResultId", "drill_run_result_id", "drill_run_id");
}

function present(items: WorkspaceRecord[], item: WorkspaceRecord) {
  const id = text(item.id);
  return items.find((candidate) => id ? text(candidate.id) === id : same(candidate, item));
}

// A removed result is a correction when a new result now holds the same key.
function replacementFor(existingResults: WorkspaceRecord[], nextResults: WorkspaceRecord[], item: WorkspaceRecord) {
  const key = resultKey(item);
  if (!key) return undefined;
  const existingIds = new Set(existingResults.map((result) => text(result.id)).filter(Boolean));
  return nextResults.find((candidate) =>
    resultKey(candidate) === key && Boolean(text(candidate.id)) && !existingIds.has(text(candidate.id)),
  );
}

function revisedResultIds(existing: WorkspaceRecord, next: WorkspaceRecord) {
  const before = collection(existing, "results", "drill_run_results");
  const after = collection(next, "results", "drill_run_results");
  return new Set(before.flatMap((item) => {
    const id = text(item.id);
    if (!id) return [];
    const current = present(after, item);
    if (current) return same(current, item) ? [] : [id];
    return replacementFor(before, after, item) ? [id] : [];
  }));
}

function historicalEvidenceRemoved(existing: WorkspaceRecord, next: WorkspaceRecord) {
  const beforeResults = collection(existing, "results", "drill_run_results");
  const afterResults = collection(next, "results", "drill_run_results");
  const revised = revisedResultIds(existing, next);
  const resultRemoved = beforeResults.some((item) =>
    !present(afterResults, item) && !replacementFor(beforeResults, afterResults, item),
  );
  const malfunctionRemoved = collection(existing, "malfunctions", "firearm_malfunctions").some((item) =>
    !present(collection(next, "malfunctions", "firearm_malfunctions"), item) && !revised.has(malfunctionResultId(item)),
  );
  return resultRemoved || malfunctionRemoved;
}

/**
 * Returns the workspace to store: the client's document plus the append-only
 * `resultRevisions` history. The history is rebuilt from the stored copy on every
 * write, so a client can neither shrink nor rewrite it, and clients that do not
 * know about it keep working.
 */
export function withRangeResultRevisions<T extends object>(input: {
  existingWorkspace: unknown;
  nextWorkspace: T;
  revisedAt: string;
  revisedByUserId: string;
}): T & { resultRevisions: WorkspaceRecord[] } {
  const existing = record(input.existingWorkspace);
  const next = record(input.nextWorkspace);
  const history = collection(existing, "resultRevisions", "result_revisions");
  const revisions: WorkspaceRecord[] = [];
  const revise = (name: string, previous: WorkspaceRecord, replacedById: string) => revisions.push({
    id: `revision-${input.revisedAt}-${revisions.length}`,
    collection: name,
    recordId: text(previous.id),
    rangeDayId: field(previous, "rangeDayId", "range_day_id"),
    replacedById,
    revisedAt: input.revisedAt,
    revisedByUserId: input.revisedByUserId,
    previous,
  });

  const beforeResults = collection(existing, "results", "drill_run_results");
  const afterResults = collection(next, "results", "drill_run_results");
  beforeResults.forEach((item) => {
    const current = present(afterResults, item);
    if (current && same(current, item)) return;
    revise("results", item, text((current ?? replacementFor(beforeResults, afterResults, item))?.id));
  });
  const afterMalfunctions = collection(next, "malfunctions", "firearm_malfunctions");
  collection(existing, "malfunctions", "firearm_malfunctions").forEach((item) => {
    const current = present(afterMalfunctions, item);
    if (current && same(current, item)) return;
    revise("malfunctions", item, text(current?.id));
  });

  const stored: WorkspaceRecord = { ...(input.nextWorkspace as WorkspaceRecord) };
  delete stored.result_revisions;
  return { ...stored, resultRevisions: [...history, ...revisions] } as T & { resultRevisions: WorkspaceRecord[] };
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
  if (historicalEvidenceRemoved(existing, next)) {
    return { ok: false, status: 409, error: "Saved scores and malfunction history cannot be removed from the range workspace." };
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

export const STALE_RANGE_WORKSPACE_ERROR =
  "This range workspace was changed on another device or by another user after you loaded it. Reload to see the latest version before saving.";

/**
 * Optional optimistic concurrency. `baseUpdatedAt` is the `updatedAt` the client
 * loaded (null when nothing was stored yet). Clients that omit it keep the
 * previous last-writer-wins behaviour.
 */
export function rangeWorkspaceVersionConflict(baseUpdatedAt: unknown, storedUpdatedAt: unknown) {
  if (baseUpdatedAt === undefined) return false;
  const stored = storedUpdatedAt === null || storedUpdatedAt === undefined
    ? null
    : new Date(storedUpdatedAt as string | Date).getTime();
  if (baseUpdatedAt === null) return stored !== null;
  if (typeof baseUpdatedAt !== "string" || stored === null) return true;
  const base = Date.parse(baseUpdatedAt);
  return Number.isNaN(base) || base !== stored;
}
