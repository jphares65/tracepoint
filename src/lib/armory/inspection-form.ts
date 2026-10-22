// UX-RB-2: the firearm inspection form starts with nothing answered. Every
// checklist item, the two safety confirmations and the overall result need an
// explicit choice before the inspection can be saved, so a zero-touch save
// can never record a pass or change the firearm's status.
import {
  INSPECTION_RESULTS,
  statusForInspectionResult,
  type InspectionResult,
} from "./firearm-status-change";

export type ChecklistStatus = "Pass" | "Fail" | "N/A";

export type FormChecklistItem = {
  id: string;
  section: string;
  label: string;
  // null = Not inspected. Never sent to the server.
  status: ChecklistStatus | null;
  note: string;
  critical?: boolean;
};

export type SubmittedChecklistItem = Omit<FormChecklistItem, "status"> & {
  status: ChecklistStatus;
};

export function notInspected<T extends { status?: unknown }>(items: T[]): Array<Omit<T, "status"> & { status: ChecklistStatus | null }> {
  return items.map((item) => ({ ...item, status: null }));
}

export function notInspectedCount(items: FormChecklistItem[]) {
  return items.filter((item) => item.status === null).length;
}

/** "Mark remaining as Pass": only items not yet inspected; answered items are never changed. */
export function markRemainingPass(items: FormChecklistItem[]) {
  return items.map((item) => (item.status === null ? { ...item, status: "Pass" as const } : item));
}

export function isInspectionResult(value: string): value is InspectionResult {
  return (INSPECTION_RESULTS as readonly string[]).includes(value);
}

export function inspectionSubmitBlockers(form: {
  firearmSelected: boolean;
  checklist: FormChecklistItem[];
  weaponCleared: string;
  ammoRemoved: string;
  result: string;
}) {
  const blockers: string[] = [];
  if (!form.firearmSelected) blockers.push("Select a firearm.");
  if (!form.weaponCleared) blockers.push("Record whether the weapon was cleared.");
  if (!form.ammoRemoved) blockers.push("Record whether ammunition was removed.");
  const remaining = notInspectedCount(form.checklist);
  if (remaining > 0) {
    blockers.push(`${remaining} checklist ${remaining === 1 ? "item is" : "items are"} not inspected.`);
  }
  if (!isInspectionResult(form.result)) {
    blockers.push("Choose the overall result.");
  } else if (
    form.result === "Passed" &&
    form.checklist.some((item) => item.critical && item.status === "Fail")
  ) {
    blockers.push("A critical item failed, so the result cannot be Passed.");
  }
  return blockers;
}

/** The body checklist: refuses to turn an uninspected item into an answer. */
export function submittedChecklist(items: FormChecklistItem[]): SubmittedChecklistItem[] {
  return items.map((item) => {
    if (item.status === null) throw new Error(`"${item.label}" is not inspected.`);
    return { ...item, status: item.status };
  });
}

/** Plain statement of what saving does to the firearm's status (server rules, ARM-17). */
export function inspectionStatusEffect(result: string) {
  if (!isInspectionResult(result)) return "Choose a result to see how saving affects this firearm's status.";
  const next = statusForInspectionResult(result);
  if (next) return `Saving a ${result} result sets this firearm to ${next}.`;
  return "Saving a Passed result returns this firearm to In Service if an earlier inspection took it out of service, unless the recommendation keeps it out. Otherwise its status does not change.";
}
