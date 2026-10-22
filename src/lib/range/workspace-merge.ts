// UX-RB-5: conflict recovery for the whole-workspace range save. When another
// device saved first, this device's own changes since its last sync are replayed
// onto the server copy record by record. Nothing typed on this device is
// discarded: where both devices changed the same record, the server's value
// stays in the workspace and this device's value is kept as a visible conflict
// the instructor resolves.
import { stable } from "./workspace-client-state.ts";

export const WORKSPACE_COLLECTIONS = [
  "rangeDays",
  "drillLibrary",
  "rangeDayDrills",
  "rangeRoster",
  "results",
  "malfunctions",
] as const;

export type WorkspaceCollection = (typeof WORKSPACE_COLLECTIONS)[number];
type Keyed = { id?: unknown } & Record<string, unknown>;
export type MergeableWorkspace = Record<WorkspaceCollection, Keyed[]>;

export type WorkspaceConflict = {
  collection: WorkspaceCollection;
  id: string;
  // This device's version; null when this device deleted the record.
  local: Keyed | null;
  // The version now on the server; null when the other device deleted it.
  server: Keyed | null;
};

const idOf = (item: Keyed) => (typeof item.id === "string" && item.id ? item.id : null);
const same = (a: unknown, b: unknown) => stable(a ?? null) === stable(b ?? null);

function byId(items: readonly Keyed[]) {
  const map = new Map<string, Keyed>();
  items.forEach((item) => {
    const id = idOf(item);
    if (id) map.set(id, item);
  });
  return map;
}

/**
 * Three-way merge. `base` is what this device last synced with the server,
 * `local` is this device now, `server` is the server now. Records without an id
 * are kept from both sides unchanged (they cannot be matched).
 */
export function mergeRangeWorkspace(base: MergeableWorkspace, local: MergeableWorkspace, server: MergeableWorkspace) {
  const merged = {} as MergeableWorkspace;
  const conflicts: WorkspaceConflict[] = [];
  let localChangesApplied = 0;

  for (const collection of WORKSPACE_COLLECTIONS) {
    const baseMap = byId(base[collection] ?? []);
    const localMap = byId(local[collection] ?? []);
    const serverMap = byId(server[collection] ?? []);
    const result = new Map<string, Keyed>();

    const ids = [...serverMap.keys(), ...[...localMap.keys()].filter((id) => !serverMap.has(id)), ...[...baseMap.keys()].filter((id) => !serverMap.has(id) && !localMap.has(id))];
    for (const id of ids) {
      const b = baseMap.get(id);
      const l = localMap.get(id);
      const s = serverMap.get(id);
      const changedHere = !same(l, b);
      if (!changedHere) {
        if (s) result.set(id, s);
      } else if (same(s, b)) {
        // Only this device changed it: replay the change (including a deletion).
        if (l) result.set(id, l);
        localChangesApplied += 1;
      } else if (same(l, s)) {
        if (s) result.set(id, s);
      } else {
        if (s) result.set(id, s);
        conflicts.push({ collection, id, local: l ?? null, server: s ?? null });
      }
    }

    const unkeyed = [...(server[collection] ?? []), ...(local[collection] ?? [])].filter((item) => !idOf(item));
    merged[collection] = [...result.values(), ...unkeyed.filter((item, index, all) => all.findIndex((other) => same(other, item)) === index)];
  }

  return { merged, conflicts, localChangesApplied };
}

/** Records on this device that differ from what the server last acknowledged. */
export function unsyncedIds(synced: readonly Keyed[], current: readonly Keyed[]) {
  const syncedMap = byId(synced);
  return new Set(current.filter((item) => {
    const id = idOf(item);
    return id !== null && !same(item, syncedMap.get(id));
  }).map((item) => idOf(item) as string));
}

/** Applies a kept local version of a conflicted record (the instructor chose this device). */
export function applyConflictChoice(workspace: MergeableWorkspace, conflict: WorkspaceConflict): MergeableWorkspace {
  const items = (workspace[conflict.collection] ?? []).filter((item) => idOf(item) !== conflict.id);
  return { ...workspace, [conflict.collection]: conflict.local ? [...items, conflict.local] : items };
}

export const EMPTY_MERGEABLE_WORKSPACE: MergeableWorkspace = {
  rangeDays: [], drillLibrary: [], rangeDayDrills: [], rangeRoster: [], results: [], malfunctions: [],
};
