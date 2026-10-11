export type EquipmentCondition = "serviceable" | "damaged" | "missing_parts" | "out_of_service";

export function validateConditionReport(input: {
  condition: string;
  notes: string;
  lifecycle: string | null;
  custody: "mine" | "available" | "assigned";
  canManage: boolean;
}): { ok: true } | { ok: false; status: 400 | 403 | 409; message: string } {
  if (!(["damaged", "missing_parts", "out_of_service"] as string[]).includes(input.condition)) {
    return { ok: false, status: 400, message: "Select Damaged, Missing Parts, or Out of Service to report a problem." };
  }
  if (!input.notes.trim() || input.notes.trim().length > 1000) {
    return { ok: false, status: 400, message: "Describe the equipment problem (1–1000 characters)." };
  }
  if (input.lifecycle !== "active") {
    return { ok: false, status: 409, message: "This asset is not active. Refresh its record before reporting." };
  }
  if (!input.canManage && input.custody === "assigned") {
    return { ok: false, status: 403, message: "Only the current custodian or an equipment manager can report this assigned asset." };
  }
  return { ok: true };
}
