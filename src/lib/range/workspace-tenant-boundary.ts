type WorkspaceRecord = Record<string, unknown>;

type CollectionName =
  | "rangeDays"
  | "drillLibrary"
  | "rangeDayDrills"
  | "rangeRoster"
  | "results"
  | "malfunctions";

const CHILD_COLLECTIONS: readonly CollectionName[] = [
  "rangeDayDrills",
  "rangeRoster",
  "results",
  "malfunctions",
];

const COLLECTIONS: readonly CollectionName[] = [
  "rangeDays",
  "drillLibrary",
  ...CHILD_COLLECTIONS,
];

function record(value: unknown): WorkspaceRecord {
  return value && typeof value === "object" ? value as WorkspaceRecord : {};
}

function records(value: unknown): WorkspaceRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is WorkspaceRecord => Boolean(item) && typeof item === "object")
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function field(item: WorkspaceRecord, camel: string, snake: string): string {
  return text(item[camel] ?? item[snake]);
}

function id(item: WorkspaceRecord): string {
  return text(item.id);
}

function owner(item: WorkspaceRecord): string {
  return field(item, "departmentId", "department_id");
}

function rangeDayId(item: WorkspaceRecord): string {
  return field(item, "rangeDayId", "range_day_id");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as WorkspaceRecord;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stable(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

function collection(workspace: WorkspaceRecord, name: CollectionName): WorkspaceRecord[] {
  return records(workspace[name]);
}

function isExplicitlyForeign(item: WorkspaceRecord, departmentId: string): boolean {
  const itemOwner = owner(item);
  return Boolean(itemOwner) && itemOwner !== departmentId;
}

function mergeCollection(
  existing: WorkspaceRecord[],
  submitted: WorkspaceRecord[],
  preserve: (item: WorkspaceRecord) => boolean,
): WorkspaceRecord[] {
  const submittedById = new Map<string, WorkspaceRecord>(
    submitted.flatMap((item): Array<[string, WorkspaceRecord]> => {
      const itemId = id(item);
      return itemId ? [[itemId, item]] : [];
    }),
  );
  const included = new Set<WorkspaceRecord>();
  const merged: WorkspaceRecord[] = [];

  for (const existingItem of existing) {
    if (preserve(existingItem)) {
      merged.push(existingItem);
      continue;
    }
    const replacement = submittedById.get(id(existingItem));
    if (replacement) {
      merged.push(replacement);
      included.add(replacement);
    }
  }

  for (const submittedItem of submitted) {
    if (!included.has(submittedItem) && !existing.some((item) => id(item) === id(submittedItem))) {
      merged.push(submittedItem);
    }
  }

  return merged;
}

/**
 * Removes records that cannot be proven to belong to the active department
 * before a browser serializes its workspace. Ownerless legacy records remain
 * eligible because the workspace row itself is tenant-scoped.
 */
export function workspaceForActiveDepartment<T extends WorkspaceRecord>(
  workspace: T,
  departmentId: string,
): T {
  const source = record(workspace);
  const rangeDays = collection(source, "rangeDays").filter(
    (item) => !isExplicitlyForeign(item, departmentId),
  );
  const rangeDayIds = new Set(rangeDays.map(id).filter(Boolean));
  const drillLibrary = collection(source, "drillLibrary").filter(
    (item) => !isExplicitlyForeign(item, departmentId),
  );
  const filtered: WorkspaceRecord = { ...source, rangeDays, drillLibrary };

  for (const name of CHILD_COLLECTIONS) {
    filtered[name] = collection(source, name).filter((item) => {
      const parentId = rangeDayId(item);
      return Boolean(parentId) && rangeDayIds.has(parentId);
    });
  }

  return filtered as T;
}

/**
 * Reattaches foreign or unlinked legacy records from the tenant's stored JSON
 * after a browser has submitted only active-department records. These records
 * are copied byte-for-byte from the server; they are never accepted from the
 * client as edits.
 */
export function mergeProtectedWorkspaceRecords(
  existingWorkspace: unknown,
  submittedWorkspace: unknown,
  departmentId: string,
): WorkspaceRecord {
  const existing = record(existingWorkspace);
  const submitted = record(submittedWorkspace);
  const protectedRangeDayIds = new Set(
    collection(existing, "rangeDays")
      .filter((item) => isExplicitlyForeign(item, departmentId))
      .map(id)
      .filter(Boolean),
  );
  const merged: WorkspaceRecord = { ...submitted };

  merged.rangeDays = mergeCollection(
    collection(existing, "rangeDays"),
    collection(submitted, "rangeDays"),
    (item) => isExplicitlyForeign(item, departmentId),
  );
  merged.drillLibrary = mergeCollection(
    collection(existing, "drillLibrary"),
    collection(submitted, "drillLibrary"),
    (item) => isExplicitlyForeign(item, departmentId),
  );

  for (const name of CHILD_COLLECTIONS) {
    merged[name] = mergeCollection(
      collection(existing, name),
      collection(submitted, name),
      (item) => {
        const parentId = rangeDayId(item);
        return !parentId || protectedRangeDayIds.has(parentId);
      },
    );
  }

  return merged;
}

/**
 * Rejects collisions where a client tries to smuggle an edit to a protected
 * server record by reusing its id without its foreign owner field.
 */
export function attemptsProtectedRecordMutation(
  existingWorkspace: unknown,
  submittedWorkspace: unknown,
  departmentId: string,
): boolean {
  const existing = record(existingWorkspace);
  const submitted = record(submittedWorkspace);
  const protectedRangeDays = collection(existing, "rangeDays").filter(
    (item) => isExplicitlyForeign(item, departmentId),
  );
  const protectedRangeDayIds = new Set(protectedRangeDays.map(id).filter(Boolean));

  for (const name of ["rangeDays", "drillLibrary"] as const) {
    const protectedItems = collection(existing, name).filter(
      (item) => isExplicitlyForeign(item, departmentId),
    );
    for (const item of collection(submitted, name)) {
      const protectedItem = protectedItems.find((candidate) => id(candidate) === id(item));
      if (protectedItem && !same(protectedItem, item)) return true;
    }
  }

  return CHILD_COLLECTIONS.some((name) =>
    collection(submitted, name).some((item) => {
      if (!protectedRangeDayIds.has(rangeDayId(item))) return false;
      const existingItem = collection(existing, name).find(
        (candidate) => id(candidate) === id(item),
      );
      return !existingItem || !same(existingItem, item);
    }),
  );
}

export const rangeWorkspaceCollectionNames = COLLECTIONS;
