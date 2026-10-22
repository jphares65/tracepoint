// D-22: an officer's readiness badge and percentage come from one set, the
// requirements that affect readiness. Tracked-only requirements are still
// listed, but a missing tracked-only item never makes an officer Not Ready.
const READY_STATUSES = new Set(["current", "due_soon", "inspection_due_soon"]);

type ReadinessRow = { affectsReadiness: boolean; status: string; equipmentTypeId: string };

export function readinessGroupSummary(rows: ReadinessRow[]) {
  const counted = rows.filter((row) => row.affectsReadiness);
  const readyCount = counted.filter((row) => READY_STATUSES.has(row.status)).length;
  return {
    readinessPercent: counted.length ? Math.round((readyCount / counted.length) * 100) : 100,
    ready: readyCount === counted.length,
  };
}

// Assigned kit already shown by a requirement row is not listed a second time.
export function otherAssignedAssets<T extends { equipment_type_id: string }>(assets: T[], rows: ReadinessRow[]) {
  const required = new Set(rows.map((row) => row.equipmentTypeId));
  return assets.filter((asset) => !required.has(asset.equipment_type_id));
}
