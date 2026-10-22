// UX-RB-4: the one request contract and eligibility rule for restricted-firearm
// custody (database/aws/031 operate_restricted_firearm_custody), shared by the
// API route and both pages that operate custody, so they cannot drift apart.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RestrictedCustodyAction = "CHECK_IN" | "CHECK_OUT";

export type RestrictedCustodyRequest = {
  action: RestrictedCustodyAction;
  storageLocationId?: string | null;
  notes?: string | null;
  idempotencyKey: string;
};

const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The page's request body. The reason is required and is recorded in the event's notes. */
export function restrictedCustodyRequest(input: {
  action: RestrictedCustodyAction;
  storageLocationId?: string | null;
  reason: string;
  notes?: string | null;
  idempotencyKey: string;
}): RestrictedCustodyRequest {
  const reason = clean(input.reason);
  if (!reason) throw new Error("A reason is required.");
  if (input.action === "CHECK_IN" && !clean(input.storageLocationId)) throw new Error("Choose a secure-storage location.");
  const notes = clean(input.notes);
  return {
    action: input.action,
    ...(input.action === "CHECK_IN" ? { storageLocationId: clean(input.storageLocationId) } : {}),
    notes: notes ? `${reason} — ${notes}` : reason,
    idempotencyKey: input.idempotencyKey,
  };
}

/** The route's parser. Returns the RPC arguments or the 400 message. */
export function parseRestrictedCustodyRequest(firearmId: string, body: Record<string, unknown>):
  | { ok: true; action: RestrictedCustodyAction; storageLocationId: string | null; notes: string | null; idempotencyKey: string }
  | { ok: false; error: string } {
  const action = clean(body.action);
  const idempotencyKey = clean(body.idempotencyKey) ?? "";
  if (!UUID.test(firearmId) || (action !== "CHECK_OUT" && action !== "CHECK_IN") || !UUID.test(idempotencyKey)) {
    return { ok: false, error: "A valid firearm, restricted custody action, and idempotency key are required." };
  }
  return { ok: true, action, storageLocationId: clean(body.storageLocationId), notes: clean(body.notes), idempotencyKey };
}

type Restriction = {
  is_active?: boolean | null;
  restriction_type?: string | null;
  duty_only?: boolean | null;
  no_possession_permitted?: boolean | null;
  effective_start?: string | null;
  expires_at?: string | null;
};

/**
 * Mirrors 031: an active assignment and an active, in-effect Duty Only
 * restriction; the caller is the assignee or holds
 * manage_restricted_firearm_custody; CHECK_IN moves an officer-held firearm to
 * storage, CHECK_OUT returns a stored firearm to the assignee.
 */
export function restrictedCustodyOperations(input: {
  assignedToUserId: string | null | undefined;
  userId: string;
  canManageRestrictedCustody: boolean;
  restrictions: Restriction[];
  holderType: string | null | undefined;
  holderUserId: string | null | undefined;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).getTime();
  const active = input.restrictions.find((restriction) =>
    restriction.is_active === true &&
    (!restriction.effective_start || new Date(restriction.effective_start).getTime() <= now) &&
    (!restriction.expires_at || new Date(restriction.expires_at).getTime() > now),
  );
  const dutyOnly = active ? (active.restriction_type ? active.restriction_type === "duty_only" : active.duty_only === true && active.no_possession_permitted !== true) : false;
  const permitted = Boolean(input.assignedToUserId) && dutyOnly &&
    (input.userId === input.assignedToUserId || input.canManageRestrictedCustody);
  return {
    canCheckIn: permitted && input.holderType === "OFFICER" && input.holderUserId === input.assignedToUserId,
    canCheckOut: permitted && input.holderType === "SECURE_STORAGE",
  };
}

type CustodyEvent = { action_type?: string | null; reason?: string | null; notes?: string | null; to_holder_type?: string | null };

/**
 * History line: what happened and the officer's reason/notes. 031 (restricted)
 * stores the action code in `reason`; 028 (ordinary transfer, SV-28) stores the
 * free-text reason.
 */
export function custodyEventSummary(event: CustodyEvent) {
  const what = event.reason === "CHECK_IN" || (event.action_type === "TRANSFER" && event.to_holder_type === "SECURE_STORAGE")
    ? "Checked in to secure storage"
    : event.reason === "CHECK_OUT"
      ? "Returned to assigned officer"
      : event.action_type === "TRANSFER" && event.to_holder_type === "OFFICER"
        ? "Checked out to officer"
        : event.action_type === "INITIALIZE"
          ? event.to_holder_type === "SECURE_STORAGE" ? "Custody first recorded in secure storage" : "Custody first recorded with officer"
          : String(event.action_type ?? "Custody change").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const legacyReason = event.reason && event.reason !== "CHECK_IN" && event.reason !== "CHECK_OUT" ? event.reason : null;
  const detail = [legacyReason, clean(event.notes)].filter(Boolean).join(" — ");
  return detail ? `${what} · ${detail}` : what;
}
