export type FirearmInventoryView = "standard" | "focus";
export type FirearmInventoryColumn = "firearm" | "serial" | "type" | "status" | "custody" | "asset";
export type FirearmSortKey = FirearmInventoryColumn | "caliber";
export type SortDirection = "asc" | "desc";

type SortableFirearm = {
  make: string;
  model: string;
  serial_number: string;
  firearm_type: string;
  caliber?: string | null;
  asset_number?: string | null;
  condition_status?: string | null;
  active_assignment?: { assigned_to_name?: string | null } | null;
};

export function toggleFirearmInventoryView(view: FirearmInventoryView): FirearmInventoryView {
  return view === "standard" ? "focus" : "standard";
}

export function nextFirearmSort(
  currentKey: FirearmSortKey,
  currentDirection: SortDirection,
  requestedKey: FirearmSortKey,
): { key: FirearmSortKey; direction: SortDirection } {
  return requestedKey === currentKey
    ? { key: requestedKey, direction: currentDirection === "asc" ? "desc" : "asc" }
    : { key: requestedKey, direction: "asc" as SortDirection };
}

export function sortFirearmInventory<T extends SortableFirearm>(
  firearms: T[],
  key: FirearmSortKey,
  direction: SortDirection,
) {
  const value = (firearm: T) => {
    switch (key) {
      case "firearm": return `${firearm.make} ${firearm.model}`.trim();
      case "serial": return firearm.serial_number;
      case "type": return firearm.firearm_type;
      case "caliber": return firearm.caliber ?? "";
      case "status": return firearm.condition_status ?? "In Service";
      case "custody": return firearm.active_assignment?.assigned_to_name ?? "Unassigned";
      case "asset": return firearm.asset_number ?? "";
    }
  };

  return [...firearms].sort((left, right) => {
    const comparison = value(left).localeCompare(value(right), undefined, { numeric: true, sensitivity: "base" });
    return direction === "asc" ? comparison : -comparison;
  });
}

export function matchesFirearmInventorySearch(
  firearm: SortableFirearm & { caliber?: string | null },
  query: string,
) {
  if (!query.trim()) return true;
  const normalized = query.toLowerCase();
  return [
    firearm.make, firearm.model, firearm.serial_number, firearm.asset_number,
    firearm.caliber, firearm.firearm_type, firearm.condition_status,
    firearm.active_assignment?.assigned_to_name,
  ].some((field) => typeof field === "string" && field.toLowerCase().includes(normalized));
}
