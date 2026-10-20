export type EquipmentAssignment = {
  assignedUserId: string | null;
  assignedVehicleId: string | null;
  assignedLocation: string | null;
};

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function equipmentAssignment(body: Record<string, unknown>): EquipmentAssignment {
  const assignment = {
    assignedUserId: optionalText(body.assignedUserId),
    assignedVehicleId: optionalText(body.assignedVehicleId),
    assignedLocation: optionalText(body.assignedLocation),
  };
  if (Object.values(assignment).filter(Boolean).length > 1) {
    throw new Error("Equipment can be assigned to only one officer, vehicle, or location.");
  }
  return assignment;
}

export function equipmentIdentifierConflict(errorCode: string | undefined) {
  return errorCode === "23505"
    ? "An equipment record with this serial or asset number already exists."
    : null;
}

// Calendar dates (issue, expiration, inspection) are YYYY-MM-DD; blank clears.
export function equipmentDate(value: unknown, label: string) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const valueText = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valueText);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !date || date.toISOString().slice(0, 10) !== valueText) {
    throw new Error(`${label} must be a valid date (YYYY-MM-DD).`);
  }
  return valueText;
}
