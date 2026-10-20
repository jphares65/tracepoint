import type { AmmoWorkspaceV2 } from "./ammunition-workspace";

type LegacyProjection = {
  dutyLots: unknown[];
  trainingLots: unknown[];
  transactions: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projection(value: Record<string, unknown>): LegacyProjection {
  return {
    dutyLots: Array.isArray(value.dutyLots) ? value.dutyLots : [],
    trainingLots: Array.isArray(value.trainingLots) ? value.trainingLots : [],
    transactions: Array.isArray(value.transactions) ? value.transactions : [],
  };
}

function uniqueIds(rows: unknown[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) {
      throw new Error(`Invalid ammunition ${label} identity.`);
    }
    ids.add(row.id);
  }
  return ids;
}

// Preserve canonical V2 data verbatim; the legacy arrays are only a compatibility projection.
export function ammunitionWorkspaceForStorage(value: unknown): LegacyProjection | (AmmoWorkspaceV2 & LegacyProjection) {
  const workspace = isRecord(value) ? value : {};
  const legacy = projection(workspace);
  const hasModernData = ["schemaVersion", "ammoTypes", "lots", "activity", "reconciliations", "settings"]
    .some((key) => key in workspace);
  if (!hasModernData) return legacy;

  if (workspace.schemaVersion !== 2 || !Array.isArray(workspace.ammoTypes) ||
      !Array.isArray(workspace.lots) || !Array.isArray(workspace.activity) ||
      !Array.isArray(workspace.reconciliations) || !isRecord(workspace.settings)) {
    throw new Error("Invalid canonical ammunition workspace.");
  }

  const typeIds = uniqueIds(workspace.ammoTypes, "type");
  uniqueIds(workspace.lots, "lot");
  for (const row of workspace.ammoTypes) {
    if (typeof row.name !== "string" || !row.name.trim()) {
      throw new Error("Invalid ammunition type name.");
    }
  }
  for (const row of workspace.lots) {
    if (typeof row.ammoTypeId !== "string" || !typeIds.has(row.ammoTypeId)) {
      throw new Error("Ammunition lot has no canonical type.");
    }
  }

  return {
    schemaVersion: 2,
    ammoTypes: workspace.ammoTypes,
    lots: workspace.lots,
    activity: workspace.activity,
    reconciliations: workspace.reconciliations,
    settings: workspace.settings,
    ...legacy,
  } as AmmoWorkspaceV2 & LegacyProjection;
}

export class AmmunitionWorkspaceRejected extends Error {
  constructor(message: string, readonly status: 400 | 409) {
    super(message);
  }
}

function rowsById(rows: unknown): Map<string, Record<string, unknown>> {
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter(isRecord)
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row]),
  );
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

// Server-side ledger rules for a canonical workspace save (ARM-21, ARM-22):
// - every activity and count carries the account that recorded it, stamped
//   here for new rows and carried over from the stored document for existing
//   ones, so a browser can neither omit nor rewrite it;
// - a new count is judged against the stored on-hand quantity, not the one
//   the browser sends, and a non-zero variance needs an explanation.
export function stampAmmunitionWorkspace<T extends ReturnType<typeof ammunitionWorkspaceForStorage>>(
  next: T,
  storedValue: unknown,
  actor: { userId: string; name: string },
): T {
  if (!("schemaVersion" in next)) return next;
  const stored = isRecord(storedValue) ? storedValue : {};
  const storedActivity = rowsById(stored.activity);
  const storedCounts = rowsById(stored.reconciliations);
  const storedTypes = rowsById(stored.ammoTypes);

  const reconciliations = (next.reconciliations as unknown[]).map((row) => {
    const count = row as Record<string, unknown>;
    const previous = storedCounts.get(String(count.id));
    if (previous) {
      return { ...count, countedByUserId: previous.countedByUserId ?? null, countedByName: previous.countedByName ?? null };
    }
    const type = storedTypes.get(String(count.ammoTypeId));
    const expected = Number(type?.currentOnHand ?? 0);
    const physical = Number(count.physicalQuantity);
    if (type && Number(count.expectedQuantity) !== expected) {
      throw new AmmunitionWorkspaceRejected(
        `The ${String(type.name ?? "ammunition")} on-hand quantity changed to ${expected} since this count was started. Reload and count again.`,
        409,
      );
    }
    const variance = Number.isFinite(physical) ? physical - expected : 0;
    if (variance !== 0 && !hasText(count.notes)) {
      throw new AmmunitionWorkspaceRejected(
        "Explain the count variance before confirming a physical count that does not match the expected quantity.",
        400,
      );
    }
    return { ...count, expectedQuantity: expected, variance, countedByUserId: actor.userId, countedByName: actor.name };
  });

  const activity = (next.activity as unknown[]).map((row) => {
    const entry = row as Record<string, unknown>;
    const previous = storedActivity.get(String(entry.id));
    if (previous) {
      return { ...entry, recordedByUserId: previous.recordedByUserId ?? null, recordedByName: previous.recordedByName ?? null };
    }
    if (entry.kind === "Physical Count" && Number(entry.quantityChange) !== 0 && !hasText(entry.notes)) {
      throw new AmmunitionWorkspaceRejected(
        "Explain the count variance before confirming a physical count that does not match the expected quantity.",
        400,
      );
    }
    return { ...entry, recordedByUserId: actor.userId, recordedByName: actor.name };
  });

  return { ...next, activity, reconciliations } as T;
}
