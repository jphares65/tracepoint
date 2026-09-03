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
