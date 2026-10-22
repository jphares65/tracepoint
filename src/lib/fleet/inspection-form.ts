// UX-RB-2: a vehicle inspection starts with every check Not inspected. Only a
// condition the equipment record already shows (Missing, Attention, Out of
// Service) is carried in, never a Pass. The inspector answers each item, or
// consciously uses "Mark remaining as Pass", before the form can be sent.
export type VehicleCondition = "Pass" | "Defect" | "Critical";

export type VehicleFormItem = {
  id: string;
  label: string;
  critical: boolean;
  // null = Not inspected. Never sent to the server.
  condition: VehicleCondition | null;
  note: string;
};

export function initialEquipmentCondition(status: string | null | undefined, critical: boolean): VehicleCondition | null {
  if (status === "Out of Service") return "Critical";
  if (status === "Missing" || status === "Attention") return critical ? "Critical" : "Defect";
  return null;
}

export function notInspectedCount(items: { condition: VehicleCondition | null }[]) {
  return items.filter((item) => item.condition === null).length;
}

export function markRemainingPass<T extends { condition: VehicleCondition | null }>(items: T[]): T[] {
  return items.map((item) => (item.condition === null ? { ...item, condition: "Pass" as const } : item));
}

export function vehicleSubmitBlockers(items: VehicleFormItem[]) {
  const blockers: string[] = [];
  const remaining = notInspectedCount(items);
  if (remaining > 0) blockers.push(`${remaining} ${remaining === 1 ? "item is" : "items are"} not inspected.`);
  const missingNote = items.find((item) => item.condition !== null && item.condition !== "Pass" && !item.note.trim());
  if (missingNote) blockers.push(`Add a short note for ${missingNote.label}.`);
  return blockers;
}

/** The body checklist: refuses to turn an uninspected item into an answer. */
export function submittedVehicleChecklist<T extends VehicleFormItem>(items: T[]) {
  return items.map((item) => {
    if (item.condition === null) throw new Error(`"${item.label}" is not inspected.`);
    return { ...item, condition: item.condition };
  });
}
