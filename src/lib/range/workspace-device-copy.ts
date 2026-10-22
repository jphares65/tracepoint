// UX-RB-5 (review H2): this device's copy of the range workspace and the sync
// point it belongs to are one record, written with one setItem, so a reload can
// never pair a local copy with another tab's merge base. The record names the
// user and agency it belongs to; a copy for anyone else is never shown or merged.
import {
  mergeRangeWorkspace,
  reconcileConflicts,
  withoutRefusedChanges,
  type MergeableWorkspace,
  type WorkspaceConflict,
} from "./workspace-merge.ts";

export const RANGE_DAY_DEVICE_COPY_KEY = "tracepoint.rangeDays.device.v2";

export type RangeDayDeviceCopy = {
  version: 2;
  userId: string;
  // null when the copy was written before the agency was known (first load failed).
  departmentId: string | null;
  tabId: string;
  workspace: unknown;
  // What this device last synced with the server; null when that is not known.
  base: MergeableWorkspace | null;
  baseUpdatedAt: string | null;
  conflicts: WorkspaceConflict[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readDeviceCopy(storage: StorageLike | null): RangeDayDeviceCopy | null {
  try {
    const stored = storage?.getItem(RANGE_DAY_DEVICE_COPY_KEY);
    const copy = stored ? (JSON.parse(stored) as RangeDayDeviceCopy) : null;
    return copy && copy.version === 2 && typeof copy.userId === "string" ? copy : null;
  } catch {
    return null;
  }
}

/** Returns false when the copy could not be kept (for example storage is full). */
export function writeDeviceCopy(storage: StorageLike | null, copy: RangeDayDeviceCopy) {
  if (!storage) return false;
  try {
    storage.setItem(RANGE_DAY_DEVICE_COPY_KEY, JSON.stringify(copy));
    return true;
  } catch {
    return false;
  }
}

/** A copy is used only for the same user, and only for the same agency once the agency is known. */
export function usableDeviceCopy(copy: RangeDayDeviceCopy | null, owner: { userId: string; departmentId: string | null }) {
  if (!copy || !owner.userId || copy.userId !== owner.userId) return null;
  if (owner.departmentId && copy.departmentId && copy.departmentId !== owner.departmentId) return null;
  return copy;
}

/**
 * Brings this device's work onto the server copy: replays its own changes when
 * the sync point is known, lists everything that differs when it is not, holds
 * back any change the server would refuse, and keeps one conflict per record.
 */
export function recoverWorkspace(input: {
  base: MergeableWorkspace | null;
  local: MergeableWorkspace;
  server: MergeableWorkspace;
  // No workspace is stored on the server yet: there is nothing to lose there.
  serverEmpty?: boolean;
  conflicts: readonly WorkspaceConflict[];
  accept: (workspace: MergeableWorkspace) => { ok: true } | { ok: false; error: string };
}) {
  const unknownBase = !input.base && !input.serverEmpty;
  const merge = mergeRangeWorkspace(input.base ?? input.server, input.local, input.server, { unknownBase });
  const { workspace, refused } = withoutRefusedChanges(merge.merged, merge.applied, input.server, input.accept);
  // A record edited again on this device after an earlier conflict now holds the newer value.
  const refusedKeys = new Set(refused.map((conflict) => `${conflict.collection}:${conflict.id}`));
  const replayed = new Set(merge.applied.map((change) => `${change.collection}:${change.id}`).filter((key) => !refusedKeys.has(key)));
  const earlier = input.conflicts.filter((conflict) => !replayed.has(`${conflict.collection}:${conflict.id}`));
  return {
    workspace,
    conflicts: reconcileConflicts(earlier, [...merge.conflicts, ...refused], input.server),
    applied: merge.applied.length - refused.length,
  };
}
