// Readiness alerts stay open until the condition clears; they may be snoozed
// but not acknowledged. The PATCH route and every inbox view share this list.
export const CONDITION_BASED_NOTIFICATION_KINDS: ReadonlySet<string> = new Set([
  "required_certification_missing",
  "required_certification_expired",
  "required_certification_due_soon",
  "qualification_no_record",
  "qualification_missing_day",
  "qualification_missing_night",
  "qualification_failed",
  "qualification_overdue",
  "qualification_due_soon",
  "required_equipment_missing",
  "required_equipment_expired",
  "equipment_inspection_overdue",
  "required_equipment_out_of_service",
  "equipment_expiration_due_soon",
  "equipment_inspection_due_soon",
  "agency_training_missing",
  "agency_training_overdue",
  "agency_training_due_soon",
  "agency_training_missing_staff",
  "agency_training_overdue_staff",
  "agency_training_due_soon_staff",
]);

export function notificationCanBeAcknowledged(kind: unknown) {
  return !CONDITION_BASED_NOTIFICATION_KINDS.has(String(kind ?? ""));
}
