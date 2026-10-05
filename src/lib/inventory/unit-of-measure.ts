export const INVENTORY_UNIT_OPTIONS = [
  ["each", "Each"],
  ["box", "Box"],
  ["case", "Case"],
  ["pack", "Pack"],
  ["pair", "Pair"],
  ["set", "Set"],
  ["kit", "Kit"],
  ["roll", "Roll"],
  ["bottle", "Bottle"],
  ["bag", "Bag"],
  ["carton", "Carton"],
] as const;

export function unitSelection(unit: string) {
  return INVENTORY_UNIT_OPTIONS.some(([value]) => value === unit)
    ? unit
    : "other";
}

export function nextUnitValue(current: string, selection: string) {
  if (selection !== "other") return selection;
  return unitSelection(current) === "other" ? current : "";
}
