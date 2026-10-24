import type { TracePointPermission } from "@/lib/tracepoint/permissions";

// SV-28: ordinary (unrestricted) firearm custody transfer, a separate operation
// from restricted Duty Only custody (restricted-custody.ts, database/aws/031).
//
// The database function is database/aws/028 transfer_firearm_custody:
// - to OFFICER needs firearm_custody.check_out (or manage_firearms), a holder
//   who is an active agency member, and no in-effect no-possession restriction;
// - to SECURE_STORAGE needs firearm_custody.check_in (or manage_firearms) and an
//   active storage location of the agency;
// - the assignment never changes; the event and an audit row are written.
// Administrative corrections (p_administrative_correction, firearm_custody.override)
// stay disabled: the request builder never sends one and the parser refuses one.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CustodyDirection = "CHECK_IN" | "CHECK_OUT";
export type CustodyHolderType = "OFFICER" | "SECURE_STORAGE";

export type CustodyTransferRequest = {
  toHolderType: CustodyHolderType;
  toHolderUserId: string | null;
  toStorageLocationId: string | null;
  reason: string;
  notes: string | null;
  idempotencyKey: string;
};

export type CustodyTransferArgs = {
  p_firearm_id: string;
  p_to_holder_type: CustodyHolderType;
  p_to_holder_user_id: string | null;
  p_to_storage_location_id: string | null;
  p_reason: string;
  p_notes: string | null;
  p_idempotency_key: string;
  p_administrative_correction: false;
};

const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The page's request body for an ordinary transfer (the 028 contract, without corrections). */
export function custodyTransferRequest(input: {
  direction: CustodyDirection;
  toHolderUserId?: string | null;
  storageLocationId?: string | null;
  reason: string;
  notes?: string | null;
  idempotencyKey: string;
}): CustodyTransferRequest {
  const reason = clean(input.reason);
  if (!reason) throw new Error("A reason is required.");
  if (input.direction === "CHECK_IN" && !clean(input.storageLocationId)) throw new Error("Choose a secure-storage location.");
  if (input.direction === "CHECK_OUT" && !clean(input.toHolderUserId)) throw new Error("Choose the officer who will hold the firearm.");
  return {
    toHolderType: input.direction === "CHECK_IN" ? "SECURE_STORAGE" : "OFFICER",
    toHolderUserId: input.direction === "CHECK_OUT" ? clean(input.toHolderUserId) : null,
    toStorageLocationId: input.direction === "CHECK_IN" ? clean(input.storageLocationId) : null,
    reason,
    notes: clean(input.notes),
    idempotencyKey: input.idempotencyKey,
  };
}

export type CustodyRequestKind =
  | { kind: "restricted" }
  | { kind: "transfer" }
  | { kind: "invalid"; error: string };

/**
 * The POST body names one operation: `action` (restricted Duty Only, 031) or
 * `toHolderType` (ordinary transfer, 028).
 */
export function custodyRequestKind(body: Record<string, unknown>): CustodyRequestKind {
  const hasAction = body.action !== undefined && body.action !== null;
  const hasTransfer = body.toHolderType !== undefined && body.toHolderType !== null;
  if (hasAction && hasTransfer) return { kind: "invalid", error: "Send either a restricted custody action or a custody transfer, not both." };
  if (hasAction) return { kind: "restricted" };
  if (hasTransfer) return { kind: "transfer" };
  return { kind: "invalid", error: "A custody transfer destination (toHolderType) or a restricted custody action is required." };
}

/** The route's parser for an ordinary transfer. Returns the RPC arguments or the 400 message. */
export function parseCustodyTransferRequest(firearmId: string, body: Record<string, unknown>):
  | { ok: true; args: CustodyTransferArgs }
  | { ok: false; error: string; code: string } {
  if (body.administrativeCorrection !== undefined && body.administrativeCorrection !== false && body.administrativeCorrection !== null) {
    return { ok: false, code: "administrative_correction_unavailable", error: "Administrative custody corrections are not available." };
  }
  if (!UUID.test(firearmId)) return { ok: false, code: "invalid_firearm", error: "A valid firearm is required." };
  const holderType = clean(body.toHolderType);
  if (holderType !== "OFFICER" && holderType !== "SECURE_STORAGE") {
    return { ok: false, code: "invalid_destination", error: "The custody destination must be OFFICER or SECURE_STORAGE." };
  }
  const toHolderUserId = clean(body.toHolderUserId);
  const toStorageLocationId = clean(body.toStorageLocationId);
  if (holderType === "OFFICER" && (!UUID.test(toHolderUserId ?? "") || toStorageLocationId)) {
    return { ok: false, code: "invalid_officer", error: "Checking a firearm out requires the officer who will hold it, and no storage location." };
  }
  if (holderType === "SECURE_STORAGE" && (!UUID.test(toStorageLocationId ?? "") || toHolderUserId)) {
    return { ok: false, code: "invalid_storage_location", error: "Checking a firearm in requires a secure-storage location, and no officer." };
  }
  const reason = clean(body.reason);
  if (!reason) return { ok: false, code: "reason_required", error: "A reason is required." };
  const idempotencyKey = clean(body.idempotencyKey);
  if (!UUID.test(idempotencyKey ?? "")) return { ok: false, code: "invalid_idempotency_key", error: "A valid idempotency key is required." };
  return {
    ok: true,
    args: {
      p_firearm_id: firearmId,
      p_to_holder_type: holderType,
      p_to_holder_user_id: holderType === "OFFICER" ? toHolderUserId : null,
      p_to_storage_location_id: holderType === "SECURE_STORAGE" ? toStorageLocationId : null,
      p_reason: reason,
      p_notes: clean(body.notes),
      p_idempotency_key: idempotencyKey!,
      p_administrative_correction: false,
    },
  };
}

/** The permissions 028 checks for each destination. */
export function custodyTransferPermissions(holderType: CustodyHolderType): readonly TracePointPermission[] {
  return holderType === "OFFICER" ? ["firearm_custody.check_out", "manage_firearms"] : ["firearm_custody.check_in", "manage_firearms"];
}

/** 028's exceptions, as the status and message the route returns. */
export function custodyTransferFailure(error: { code?: string | null; message?: string | null }) {
  const message = String(error.message ?? "");
  const known: Array<[RegExp, number, string]> = [
    [/active possession restriction prohibits checkout/i, 409, "This firearm is restricted No Carry and cannot be checked out to an officer."],
    [/custody permission required/i, 403, "You do not have permission for this custody transfer."],
    [/firearm unavailable/i, 404, "This firearm is not available in your agency."],
    [/custody officer unavailable/i, 400, "The officer is not an active member of this agency."],
    [/storage location unavailable/i, 400, "Choose an active secure-storage location."],
    [/invalid custody holder/i, 400, "The custody destination is incomplete."],
    [/reason and idempotency key are required/i, 400, "A reason is required."],
  ];
  const match = known.find(([pattern]) => pattern.test(message));
  if (match) return { status: match[1], error: match[2] };
  if (/^custody must follow the firearm's active assignment$/i.test(message)) return { status: 409, error: ASSIGNMENT_CHANGED };
  return { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : 409, error: message && !GENERIC_DATABASE_FAILURE.test(message) ? message : "Custody could not be updated." };
}

const GENERIC_DATABASE_FAILURE = /^PostgreSQL data operation failed\.?$/i;
const ASSIGNMENT_CHANGED = "The firearm's assignment changed while this was being saved. Reload it and try again.";

/**
 * AT-4: the refusals of set_firearm_restriction, clear_firearm_restriction and
 * operate_restricted_firearm_custody (031, 067), as the status and message the route returns.
 * They reached the officer as "PostgreSQL data operation failed." before.
 */
export function restrictedCustodyFailure(error: { code?: string | null; message?: string | null }) {
  const message = String(error.message ?? "");
  const known: Array<[RegExp, number, string]> = [
    [/^restricted use requires an active assignment$/i, 409, "Issue this firearm to an officer before restricting it."],
    [/^invalid firearm restriction$/i, 400, "This restriction is not valid for this firearm."],
    [/^restriction-management permission required$/i, 403, "Restriction-management permission is required."],
    [/^active restriction unavailable$/i, 409, "This restriction is no longer active. Reload the firearm to see its current restrictions."],
    [/^invalid restricted custody action$/i, 400, "Choose check-in or check-out."],
    [/^active assigned firearm restriction required$/i, 409, "Check-in and check-out apply only to an issued firearm with an active Duty Only restriction."],
    [/^no-carry restriction prohibits checkout$/i, 409, "This firearm is restricted No Carry and cannot be checked out."],
    [/^restricted custody is unavailable for this restriction$/i, 409, "Check-in and check-out apply only to a Duty Only restriction."],
    [/^restricted custody permission required$/i, 403, "Only the assigned officer or a custody manager can check this firearm in or out."],
    [/^physical custody must be initialized by an administrator$/i, 409, "This firearm's custody has not been recorded yet. An administrator must record who holds it first."],
    [/^firearm is not ready for this custody action$/i, 409, "This firearm is already checked in or out. Reload it to see where it is."],
    [/^secure storage location required$/i, 400, "Choose an active secure-storage location."],
    [/^custody must follow the firearm's active assignment$/i, 409, ASSIGNMENT_CHANGED],
    // AT-5 (070): a restriction set while its assignment was being returned.
    [/^restriction must follow the firearm's active assignment$/i, 409, ASSIGNMENT_CHANGED],
  ];
  const match = known.find(([pattern]) => pattern.test(message));
  if (match) return { status: match[1], error: match[2] };
  return { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : 409, error: "The firearm restriction or custody could not be updated." };
}

type Restriction = {
  is_active?: boolean | null;
  no_possession_permitted?: boolean | null;
  duty_only?: boolean | null;
  restriction_type?: string | null;
  effective_start?: string | null;
  expires_at?: string | null;
};

const inEffect = (restriction: Restriction, now: number) =>
  restriction.is_active === true &&
  (!restriction.effective_start || new Date(restriction.effective_start).getTime() <= now) &&
  (!restriction.expires_at || new Date(restriction.expires_at).getTime() > now);

/**
 * Which ordinary transfers to offer, by 028's rule. The page checks a firearm
 * out only to its assigned officer (as before 031), so check-out needs an
 * active assignment and is not offered while the assignee already holds it.
 * Check-in is offered unless the firearm is already in secure storage.
 */
export function custodyTransferOperations(input: {
  canCheckInPermission: boolean;
  canCheckOutPermission: boolean;
  assignedToUserId: string | null | undefined;
  restrictions: Restriction[];
  holderType: string | null | undefined;
  holderUserId: string | null | undefined;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).getTime();
  const noPossession = input.restrictions.some((restriction) => inEffect(restriction, now) &&
    (restriction.no_possession_permitted === true || restriction.restriction_type === "no_carry"));
  const assignee = input.assignedToUserId ?? null;
  const assigneeHolds = input.holderType === "OFFICER" && Boolean(assignee) && input.holderUserId === assignee;
  const dutyOnly = input.restrictions.some((restriction) => inEffect(restriction, now) &&
    (restriction.restriction_type === "duty_only" || (restriction.duty_only === true && restriction.no_possession_permitted !== true)));
  return {
    canCheckIn: input.canCheckInPermission && input.holderType !== "SECURE_STORAGE",
    canCheckOut: input.canCheckOutPermission && Boolean(assignee) && !noPossession && !assigneeHolds,
    checkOutToUserId: assignee,
    // Temporary custody to another active member of the agency (028). The
    // assignment does not change. Not offered while a restriction governs who
    // may hold the firearm (No Carry, or Duty Only's restricted workflow).
    canCheckOutTemporary: input.canCheckOutPermission && !noPossession && !dutyOnly,
  };
}

export type CustodyRecipient = { userId: string; name: string; badgeNumber?: string | null };

/** Active members of the agency who may receive temporary custody, excluding the current holder. */
export function custodyRecipients(
  members: Array<{ user_id: string; is_active?: boolean | null; badge_number?: string | null }>,
  names: Map<string, string | null>,
  currentHolderUserId: string | null | undefined,
): CustodyRecipient[] {
  return members
    .filter((member) => member.is_active !== false && member.user_id !== currentHolderUserId)
    .map((member) => ({ userId: member.user_id, name: names.get(member.user_id)?.trim() || "Unnamed member", badgeNumber: member.badge_number ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type CustodyOperations = {
  canCheckIn?: boolean;
  canCheckOut?: boolean;
  transfer?: { canCheckIn?: boolean; canCheckOut?: boolean; checkOutToUserId?: string | null; canCheckOutTemporary?: boolean; recipients?: CustodyRecipient[] };
  canManageStorageLocations?: boolean;
};

/**
 * One action per direction for the record page. The restricted Duty Only
 * operation is used when the caller may perform it; otherwise the ordinary
 * transfer, when the caller holds its permission. Both move the firearm to the
 * same holder (the assignee, or a storage location).
 */
export function custodyPageActions(operations: CustodyOperations | null | undefined): {
  checkIn: "restricted" | "transfer" | null;
  checkOut: "restricted" | "transfer" | null;
} {
  return {
    checkIn: operations?.canCheckIn ? "restricted" : operations?.transfer?.canCheckIn ? "transfer" : null,
    checkOut: operations?.canCheckOut ? "restricted" : operations?.transfer?.canCheckOut ? "transfer" : null,
  };
}
