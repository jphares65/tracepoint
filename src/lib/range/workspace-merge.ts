// UX-RB-5: conflict recovery for the whole-workspace range save. When another
// device saved first, this device's own changes since its last sync are replayed
// onto the server copy record by record. Nothing typed on this device is
// discarded: where both devices changed the same record, the server's value
// stays in the workspace and this device's value is kept as a visible conflict
// the instructor resolves. A replayed change the server would refuse (for
// example a score for a day another device finalized) is held back the same
// way, so it cannot block every later save.
import { stable } from "./workspace-client-state.ts";
import { resultKey } from "./workspace-mutation.ts";

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
  // The version now on the server; null when the other device deleted it (or never had it).
  server: Keyed | null;
  // Why this device's value cannot simply be used: the server's refusal, or an
  // unknown merge base. Absent for an ordinary both-devices-changed conflict.
  reason?: string;
};

export type AppliedChange = { collection: WorkspaceCollection; id: string; local: Keyed | null };

export const UNKNOWN_BASE_REASON = "This device's copy could not be matched to a saved version.";

const idOf = (item: Keyed) =>
  typeof item.id === "string" && item.id ? item.id : typeof item.id === "number" && Number.isFinite(item.id) ? String(item.id) : null;
const same = (a: unknown, b: unknown) => stable(a ?? null) === stable(b ?? null);

// The same logical record created independently on two devices gets two ids;
// these keys match them so they meet as one record (H3).
const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");
const LOGICAL_KEYS: Partial<Record<WorkspaceCollection, (item: Keyed) => string>> = {
  results: (item) => resultKey(item),
  rangeRoster: (item) => {
    const day = text(item.rangeDayId ?? item.range_day_id);
    const officer = text(item.officerId ?? item.officer_id);
    return day && officer ? `${day}|${officer}` : "";
  },
};

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
 * `local` is this device now, `server` is the server now. With `unknownBase`
 * (a copy whose sync point is not known) no local value is replayed: every
 * record that differs from the server is listed as a conflict instead.
 */
export function mergeRangeWorkspace(
  base: MergeableWorkspace,
  local: MergeableWorkspace,
  server: MergeableWorkspace,
  options: { unknownBase?: boolean } = {},
) {
  const merged = {} as MergeableWorkspace;
  const conflicts: WorkspaceConflict[] = [];
  const applied: AppliedChange[] = [];

  for (const collection of WORKSPACE_COLLECTIONS) {
    const baseMap = byId(base[collection] ?? []);
    const serverMap = byId(server[collection] ?? []);
    const localMap = aliasToServer(collection, byId(local[collection] ?? []), baseMap, serverMap);
    const result = new Map<string, Keyed>();

    const ids = [...serverMap.keys(), ...[...localMap.keys()].filter((id) => !serverMap.has(id)), ...[...baseMap.keys()].filter((id) => !serverMap.has(id) && !localMap.has(id))];
    for (const id of ids) {
      const b = options.unknownBase ? undefined : baseMap.get(id);
      const l = localMap.get(id);
      const s = serverMap.get(id);
      if (options.unknownBase) {
        if (s) result.set(id, s);
        if (l && !same(l, s)) conflicts.push({ collection, id, local: l, server: s ?? null, reason: UNKNOWN_BASE_REASON });
        continue;
      }
      const changedHere = !same(l, b);
      if (!changedHere) {
        if (s) result.set(id, s);
      } else if (same(s, b)) {
        // Only this device changed it: replay the change (including a deletion).
        if (l) result.set(id, l);
        applied.push({ collection, id, local: l ?? null });
      } else if (same(l, s)) {
        if (s) result.set(id, s);
      } else {
        if (s) result.set(id, s);
        conflicts.push({ collection, id, local: l ?? null, server: s ?? null });
      }
    }

    // Records without an id cannot be matched: the server's are kept as they
    // are, and only this device's new ones are added.
    const serverUnkeyed = (server[collection] ?? []).filter((item) => !idOf(item));
    const known = [...serverUnkeyed, ...(base[collection] ?? []).filter((item) => !idOf(item))];
    const localUnkeyed = (local[collection] ?? []).filter((item) => !idOf(item) && !known.some((other) => same(other, item)));
    merged[collection] = [...result.values(), ...serverUnkeyed, ...localUnkeyed];
  }

  return { merged, conflicts, applied, localChangesApplied: applied.length };
}

// A record this device created (not in its base) that the server already holds
// under another id with the same logical key is treated as this device's
// version of the server's record.
function aliasToServer(collection: WorkspaceCollection, localMap: Map<string, Keyed>, baseMap: Map<string, Keyed>, serverMap: Map<string, Keyed>) {
  const keyOf = LOGICAL_KEYS[collection];
  if (!keyOf) return localMap;
  const serverByKey = new Map<string, string>();
  serverMap.forEach((item, id) => {
    const key = keyOf(item);
    if (key && !localMap.has(id) && !serverByKey.has(key)) serverByKey.set(key, id);
  });
  const aliased = new Map<string, Keyed>();
  localMap.forEach((item, id) => {
    const key = keyOf(item);
    const serverId = !serverMap.has(id) && !baseMap.has(id) && key ? serverByKey.get(key) : undefined;
    if (serverId && !aliased.has(serverId)) {
      serverByKey.delete(key);
      aliased.set(serverId, { ...item, id: serverMap.get(serverId)!.id });
    } else {
      aliased.set(id, item);
    }
  });
  return aliased;
}

function withRecord(workspace: MergeableWorkspace, collection: WorkspaceCollection, id: string, value: Keyed | null): MergeableWorkspace {
  const items = workspace[collection] ?? [];
  const index = items.findIndex((item) => idOf(item) === id);
  const next = index < 0 ? [...items] : items.filter((_, position) => position !== index);
  if (value) {
    if (index < 0) next.push(value);
    else next.splice(index, 0, value);
  }
  return { ...workspace, [collection]: next };
}

/**
 * H1: replays only the changes the server would accept. `accept` is the
 * server's own decision (previewRangeWorkspaceMutation) for a candidate
 * workspace; each refused change is returned as a conflict with the reason and
 * left out of the workspace, so the rest of this device's work still saves.
 */
export function withoutRefusedChanges(
  merged: MergeableWorkspace,
  applied: readonly AppliedChange[],
  server: MergeableWorkspace,
  accept: (workspace: MergeableWorkspace) => { ok: true } | { ok: false; error: string },
) {
  const first = accept(merged);
  if (first.ok) return { workspace: merged, refused: [] as WorkspaceConflict[] };
  const serverMaps = Object.fromEntries(WORKSPACE_COLLECTIONS.map((collection) => [collection, byId(server[collection] ?? [])])) as Record<WorkspaceCollection, Map<string, Keyed>>;
  let workspace = applied.reduce((current, change) => withRecord(current, change.collection, change.id, serverMaps[change.collection].get(change.id) ?? null), merged);
  const refused: WorkspaceConflict[] = [];
  const reverted = accept(workspace);
  for (const change of applied) {
    const candidate = withRecord(workspace, change.collection, change.id, change.local);
    const decision = reverted.ok ? accept(candidate) : reverted;
    if (decision.ok) workspace = candidate;
    else refused.push({ collection: change.collection, id: change.id, local: change.local, server: serverMaps[change.collection].get(change.id) ?? null, reason: decision.error });
  }
  return { workspace, refused };
}

/**
 * M2/M3: one conflict per record. A newer conflict replaces an older one, each
 * kept conflict shows the server's current value, and a conflict whose two
 * values now agree is dropped.
 */
export function reconcileConflicts(existing: readonly WorkspaceConflict[], incoming: readonly WorkspaceConflict[], server: MergeableWorkspace) {
  const byKey = new Map<string, WorkspaceConflict>();
  for (const conflict of [...existing, ...incoming]) byKey.set(`${conflict.collection}:${conflict.id}`, conflict);
  return [...byKey.values()]
    .map((conflict) => ({ ...conflict, server: byId(server[conflict.collection] ?? []).get(conflict.id) ?? null }))
    .filter((conflict) => !same(conflict.local, conflict.server));
}

/** Records on this device that differ from what the server last acknowledged. */
export function unsyncedIds(synced: readonly Keyed[], current: readonly Keyed[]) {
  const syncedMap = byId(synced);
  return new Set(current.filter((item) => {
    const id = idOf(item);
    return id !== null && !same(item, syncedMap.get(id));
  }).map((item) => idOf(item) as string));
}

/** Applies the instructor's choice for a conflicted record: this device's value, or the other device's. */
export function applyConflictChoice(workspace: MergeableWorkspace, conflict: WorkspaceConflict, choice: "local" | "server" = "local"): MergeableWorkspace {
  return withRecord(workspace, conflict.collection, conflict.id, choice === "local" ? conflict.local : conflict.server);
}

export const EMPTY_MERGEABLE_WORKSPACE: MergeableWorkspace = {
  rangeDays: [], drillLibrary: [], rangeDayDrills: [], rangeRoster: [], results: [], malfunctions: [],
};
