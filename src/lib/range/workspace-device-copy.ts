// UX-RB-5 (review H2): this device's copy of the range workspace and the sync
// point it belongs to are one record, written with one setItem, so a reload can
// never pair a local copy with another tab's merge base. There is one record per
// user and agency (review R2-H2): signing in as someone else, or switching
// agency, never shows, merges or overwrites another record.
import {
  mergeRangeWorkspace,
  reconcileConflicts,
  withoutRefusedChanges,
  type MergeableWorkspace,
  type WorkspaceConflict,
} from "./workspace-merge.ts";

export const RANGE_DAY_DEVICE_COPY_KEY = "tracepoint.rangeDays.device.v2";
// Pre-UX-RB storage (one copy for everyone on the device) and its 65e1cd9 sync record.
export const LEGACY_RANGE_DAY_KEYS = ["tracepoint.rangeDays.workspace.v1", "tracepoint.rangeDays.workspace.v1.sync"] as const;
export const LEGACY_COPY_REASON = "Found on this device from an earlier version of TracePoint; it may have been entered by another user. Check it before using it.";

export function deviceCopyKey(userId: string, departmentId: string | null) {
  return `${RANGE_DAY_DEVICE_COPY_KEY}.${userId}.${departmentId ?? "unknown"}`;
}
const lastAgencyKey = (userId: string) => `${RANGE_DAY_DEVICE_COPY_KEY}.${userId}.last`;
const legacyMarkerKey = (userId: string) => `${RANGE_DAY_DEVICE_COPY_KEY}.${userId}.legacy-listed`;

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

type StorageLike = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

/**
 * This user's record for the agency, or (with `departmentId` null, when the
 * agency is not known yet) the record for the agency they last used.
 */
export function readDeviceCopy(storage: StorageLike | null, userId: string, departmentId: string | null): RangeDayDeviceCopy | null {
  if (!storage || !userId) return null;
  try {
    const agency = departmentId ?? storage.getItem(lastAgencyKey(userId)) ?? null;
    const stored = storage.getItem(deviceCopyKey(userId, agency || null));
    const copy = stored ? (JSON.parse(stored) as RangeDayDeviceCopy) : null;
    return copy && copy.version === 2 && copy.userId === userId ? copy : null;
  } catch {
    return null;
  }
}

/** Returns false when the copy could not be kept (for example storage is full). */
export function writeDeviceCopy(storage: StorageLike | null, copy: RangeDayDeviceCopy) {
  if (!storage || !copy.userId) return false;
  try {
    storage.setItem(deviceCopyKey(copy.userId, copy.departmentId), JSON.stringify(copy));
    if (copy.departmentId) storage.setItem(lastAgencyKey(copy.userId), copy.departmentId);
    return true;
  } catch {
    return false;
  }
}

/** A copy written before the agency was known; read once the agency is known (review L6). */
export function takeUnknownAgencyCopy(storage: StorageLike | null, userId: string) {
  const copy = readDeviceCopy(storage, userId, null) ;
  if (!copy || copy.departmentId !== null) return null;
  return {
    copy,
    discard: () => {
      try {
        storage?.removeItem?.(deviceCopyKey(userId, null));
      } catch {
        // Left in place; it is only listed again as differences.
      }
    },
  };
}

/**
 * Review R2-M4: a copy left under the pre-UX-RB keys, offered once per user.
 * The old keys name no user or agency, so the copy is only ever listed as
 * differences for the instructor to check, never applied. The old keys are left
 * untouched.
 */
export function takeLegacyCopy(storage: StorageLike | null, userId: string) {
  if (!storage || !userId) return null;
  try {
    if (storage.getItem(legacyMarkerKey(userId))) return null;
    const stored = storage.getItem(LEGACY_RANGE_DAY_KEYS[0]);
    if (!stored) return null;
    return {
      workspace: JSON.parse(stored) as unknown,
      markListed: () => {
        try {
          storage.setItem(legacyMarkerKey(userId), new Date().toISOString());
        } catch {
          // Offered again next time.
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Records in an unattributed copy that differ from the workspace, as conflicts
 * with `reason`. Nothing is applied. Records naming another agency are skipped.
 */
export function unattributedCopyConflicts(copy: MergeableWorkspace, workspace: MergeableWorkspace, reason: string, departmentId: string | null) {
  const foreignDays = new Set(
    copy.rangeDays
      .filter((day) => departmentId && typeof day.departmentId === "string" && day.departmentId && day.departmentId !== departmentId)
      .map((day) => String(day.id)),
  );
  return mergeRangeWorkspace(workspace, copy, workspace, { unknownBase: true }).conflicts
    .filter((conflict) => {
      const record = conflict.local ?? {};
      return !foreignDays.has(String(conflict.collection === "rangeDays" ? record.id : record.rangeDayId));
    })
    .map((conflict) => ({ ...conflict, reason }));
}

/** A copy is used only for the same user, and only for the same agency once the agency is known. */
export function usableDeviceCopy(copy: RangeDayDeviceCopy | null, owner: { userId: string; departmentId: string | null }) {
  if (!copy || !owner.userId || copy.userId !== owner.userId) return null;
  if (owner.departmentId && copy.departmentId !== owner.departmentId) return null;
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
  // Review ba6bccf R4-H1: an earlier conflict is never dropped because its
  // record was edited again; it stands until chosen, or until the record's
  // current value equals this device's.
  return {
    workspace,
    conflicts: reconcileConflicts(input.conflicts, [...merge.conflicts, ...refused], workspace),
    applied: merge.applied.length - refused.length,
    heldBack: refused.length,
  };
}
