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
