// UX-RB-3: what the officer is told after submitting a vehicle inspection.
// It is built from what the server actually did (readiness status, safety
// hold, work order, audit outcome), never from whether a work order exists.
export type InspectionOutcome = {
  // saved: recorded; the form closes. not_saved: nothing recorded; the form stays open.
  saved: boolean;
  tone: "success" | "warning" | "danger";
  message: string;
  // Present when the inspection is saved but needs a follow-up from a person.
  warning?: string;
};

type Payload = {
  ok?: boolean;
  error?: string;
  inspection?: { defect_count?: number | null; critical_defect_count?: number | null } | null;
  workOrder?: unknown;
  vehicleOutOfService?: boolean;
  readiness?: { status?: string; safetyHold?: { reason?: string } | null } | null;
  audit?: { status?: string; message?: string } | null;
};

function auditWarning(payload: Payload) {
  const audit = payload.audit;
  return audit && audit.status && audit.status !== "recorded" ? audit.message || "The inspection's audit entry was not recorded. Tell a fleet manager." : undefined;
}

export function inspectionOutcome(responseOk: boolean, payload: Payload): InspectionOutcome {
  if (!responseOk) {
    // A critical inspection is never reversed: the server keeps it and says so.
    if (payload.inspection) {
      return {
        saved: true,
        tone: "danger",
        message: payload.error || "The inspection was saved, but a later step failed. Do not submit it again; tell a fleet manager.",
        warning: auditWarning(payload),
      };
    }
    return { saved: false, tone: "danger", message: payload.error || "Inspection could not be submitted." };
  }

  const defects = Number(payload.inspection?.defect_count ?? 0);
  const routing = defects > 0
    ? payload.workOrder
      ? " Defects were sent to maintenance as a work order."
      : " Defects were recorded; no work order was created."
    : "";
  const status = payload.readiness?.status;
  const hold = payload.readiness?.safetyHold;
  const warning = auditWarning(payload);

  if (hold || status === "Out of Service") {
    return {
      saved: true,
      tone: "danger",
      message: `Inspection saved. This vehicle is Out of Service. Do not use it.${hold?.reason ? ` ${hold.reason}` : ""}${routing}`,
      warning,
    };
  }
  if (status === "Maintenance" || status === "Retired") {
    return { saved: true, tone: "warning", message: `Inspection saved. This vehicle is in ${status}.${routing}`, warning };
  }
  if (status === "Attention" || defects > 0) {
    return { saved: true, tone: "warning", message: `Inspection saved. This vehicle needs attention.${routing}`, warning };
  }
  if (status === "Available") {
    return { saved: true, tone: warning ? "warning" : "success", message: "Inspection saved. No defects; this vehicle is available.", warning };
  }
  // Unknown or missing readiness: do not claim the vehicle is ready.
  return { saved: true, tone: "warning", message: `Inspection saved. Check the vehicle's status before use.${routing}`, warning };
}
