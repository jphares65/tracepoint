/* eslint-disable @typescript-eslint/no-explicit-any -- legacy dynamic database boundary */
// Every firearm condition change goes through here so it always has its
// firearm_status_history row (ARM-11, ARM-17).

export const INSPECTION_RESULTS = [
  "Passed",
  "Failed",
  "Needs Maintenance",
  "Removed from Service",
] as const;

export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

const CHECKLIST_STATUSES = ["Pass", "Fail", "N/A"];

// History notes written by an inspection start with this text. A later Passed
// inspection returns the firearm to service only when the latest history row
// is one of these, so a manual status change is never undone by an inspection.
const INSPECTION_NOTE_PREFIX = "Inspection result ";

// Recommendations that keep a passing firearm out of service.
const KEEP_OUT_RECOMMENDATIONS = ["Maintenance Required", "Remove from Service"];

export function statusForInspectionResult(result: InspectionResult) {
  if (result === "Failed") return "Inspection Required";
  if (result === "Needs Maintenance") return "Maintenance";
  if (result === "Removed from Service") return "Out of Service";
  return null;
}

// Server-side inspection rules (ARM-16). Returns a message for a 400, or null.
export function inspectionPayloadError(body: {
  result?: unknown;
  checklist?: unknown;
}) {
  if (!body.result) return "result is required.";
  if (!INSPECTION_RESULTS.includes(body.result as InspectionResult)) {
    return `result must be one of: ${INSPECTION_RESULTS.join(", ")}.`;
  }
  if (body.checklist !== undefined && body.checklist !== null && !Array.isArray(body.checklist)) {
    return "checklist must be a list of items.";
  }
  const items = (body.checklist ?? []) as any[];
  for (const item of items) {
    if (!item || typeof item.label !== "string" || !item.label.trim()) {
      return "Each checklist item needs a label.";
    }
    if (!CHECKLIST_STATUSES.includes(item.status)) {
      return `Checklist item "${item.label.trim()}" must be Pass, Fail or N/A.`;
    }
  }
  if (
    body.result === "Passed" &&
    items.some((item) => item.critical === true && item.status === "Fail")
  ) {
    return "This inspection cannot be marked Passed while critical checklist items are failed.";
  }
  return null;
}

export function inspectionStatusNote(result: InspectionResult, inspectionId: string) {
  return `${INSPECTION_NOTE_PREFIX}${result} (inspection ${inspectionId}).`;
}

// Applies a condition change and its history row. The firearm row changes only
// from the status it was read with; if the history row cannot be written the
// change is reverted. Returns false when the firearm changed underneath.
export async function changeFirearmStatus(
  db: any,
  input: {
    departmentId: string;
    firearmId: string;
    userId: string;
    fromStatus: string | null;
    toStatus: string;
    notes: string | null;
  },
) {
  const now = new Date().toISOString();
  let update = db
    .from("firearms")
    .update({ condition_status: input.toStatus, updated_at: now })
    .eq("id", input.firearmId)
    .eq("department_id", input.departmentId);
  update = input.fromStatus === null
    ? update.is("condition_status", null)
    : update.eq("condition_status", input.fromStatus);
  const { data: changed, error: updateError } = await update
    .select("id")
    .maybeSingle();

  if (updateError) throw new Error(updateError.message);
  if (!changed) return false;

  const { error: historyError } = await db
    .from("firearm_status_history")
    .insert({
      department_id: input.departmentId,
      firearm_id: input.firearmId,
      old_status: input.fromStatus,
      new_status: input.toStatus,
      changed_by_user_id: input.userId,
      notes: input.notes,
    });

  if (historyError) {
    // A status change without its history row is not acceptable.
    await db
      .from("firearms")
      .update({ condition_status: input.fromStatus, updated_at: now })
      .eq("id", input.firearmId)
      .eq("department_id", input.departmentId);
    throw new Error(historyError.message);
  }

  return true;
}

export async function hasOpenAssignment(db: any, departmentId: string, firearmId: string) {
  const { data, error } = await db
    .from("firearm_assignments")
    .select("id")
    .eq("department_id", departmentId)
    .eq("firearm_id", firearmId)
    .is("returned_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// The status an inspection moves the firearm to, or null for no change. A
// Passed result returns the firearm to In Service only when the current
// status was set by an earlier inspection (its history row says so).
export async function inspectionTargetStatus(
  db: any,
  input: {
    departmentId: string;
    firearmId: string;
    currentStatus: string | null;
    result: InspectionResult;
    serviceRecommendation?: string | null;
  },
) {
  if (input.result !== "Passed") {
    const next = statusForInspectionResult(input.result);
    return next && next !== input.currentStatus ? next : null;
  }
  if (input.currentStatus === "In Service" || input.currentStatus === "Retired") return null;
  if (KEEP_OUT_RECOMMENDATIONS.includes(String(input.serviceRecommendation ?? ""))) return null;

  const { data: latest, error } = await db
    .from("firearm_status_history")
    .select("new_status,notes,changed_at")
    .eq("department_id", input.departmentId)
    .eq("firearm_id", input.firearmId)
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return latest &&
    latest.new_status === input.currentStatus &&
    typeof latest.notes === "string" &&
    latest.notes.startsWith(INSPECTION_NOTE_PREFIX)
    ? "In Service"
    : null;
}
