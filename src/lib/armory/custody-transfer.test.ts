import assert from "node:assert/strict";
import test from "node:test";

import {
  custodyPageActions,
  custodyRequestKind,
  custodyTransferFailure,
  custodyTransferOperations,
  custodyTransferPermissions,
  custodyTransferRequest,
  parseCustodyTransferRequest,
} from "./custody-transfer.ts";
import { custodyEventSummary, parseRestrictedCustodyRequest, restrictedCustodyRequest } from "./restricted-custody.ts";

const firearm = "30000000-0000-4000-8000-000000000001";
const officer = "20000000-0000-4000-8000-000000000001";
const key = "60000000-0000-4000-8000-000000000001";
const location = "50000000-0000-4000-8000-000000000001";

test("SV-28 defect (UX-RB): an ordinary transfer body is refused by the restricted-only parser", () => {
  const ordinary = { toHolderType: "SECURE_STORAGE", toHolderUserId: null, toStorageLocationId: location, reason: "End of shift", notes: null, idempotencyKey: key, administrativeCorrection: false };
  assert.equal(parseRestrictedCustodyRequest(firearm, ordinary).ok, false);
  // After SV-28 the same body is recognised as an ordinary transfer.
  assert.deepEqual(custodyRequestKind(ordinary), { kind: "transfer" });
});

test("SV-28: the body names exactly one operation", () => {
  assert.deepEqual(custodyRequestKind(restrictedCustodyRequest({ action: "CHECK_OUT", reason: "Start", idempotencyKey: key }) as Record<string, unknown>), { kind: "restricted" });
  assert.deepEqual(custodyRequestKind(custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: location, reason: "x", idempotencyKey: key }) as unknown as Record<string, unknown>), { kind: "transfer" });
  assert.equal(custodyRequestKind({ action: "CHECK_IN", toHolderType: "SECURE_STORAGE" }).kind, "invalid");
  assert.equal(custodyRequestKind({}).kind, "invalid");
});

test("SV-28: the page's ordinary requests parse to 028 arguments in both directions, never a correction", () => {
  const checkIn = custodyTransferRequest({ direction: "CHECK_IN", storageLocationId: location, toHolderUserId: officer, reason: " End of shift ", notes: " Locker 4 ", idempotencyKey: key });
  assert.deepEqual(checkIn, { toHolderType: "SECURE_STORAGE", toHolderUserId: null, toStorageLocationId: location, reason: "End of shift", notes: "Locker 4", idempotencyKey: key });
  assert.equal("administrativeCorrection" in checkIn, false);
  assert.deepEqual(parseCustodyTransferRequest(firearm, checkIn as unknown as Record<string, unknown>), { ok: true, args: { p_firearm_id: firearm, p_to_holder_type: "SECURE_STORAGE", p_to_holder_user_id: null, p_to_storage_location_id: location, p_reason: "End of shift", p_notes: "Locker 4", p_idempotency_key: key, p_administrative_correction: false } });
  const checkOut = custodyTransferRequest({ direction: "CHECK_OUT", storageLocationId: location, toHolderUserId: officer, reason: "Start of shift", idempotencyKey: key });
  assert.deepEqual(parseCustodyTransferRequest(firearm, checkOut as unknown as Record<string, unknown>), { ok: true, args: { p_firearm_id: firearm, p_to_holder_type: "OFFICER", p_to_holder_user_id: officer, p_to_storage_location_id: null, p_reason: "Start of shift", p_notes: null, p_idempotency_key: key, p_administrative_correction: false } });
});

test("SV-28: the pre-031 (564ff78) body is accepted unchanged when it asks for no correction", () => {
  const legacy = { toHolderType: "OFFICER", toHolderUserId: officer, toStorageLocationId: null, reason: "Issue", notes: "", idempotencyKey: key, administrativeCorrection: false };
  const parsed = parseCustodyTransferRequest(firearm, legacy);
  assert.ok(parsed.ok);
  assert.equal(parsed.ok && parsed.args.p_administrative_correction, false);
});

test("SV-28: administrative corrections stay disabled", () => {
  for (const value of [true, "true", 1]) {
    assert.deepEqual(parseCustodyTransferRequest(firearm, { toHolderType: "OFFICER", toHolderUserId: officer, reason: "Fix", idempotencyKey: key, administrativeCorrection: value }), { ok: false, code: "administrative_correction_unavailable", error: "Administrative custody corrections are not available." });
  }
});

test("SV-28: the parser refuses incomplete or contradictory destinations with a clear message", () => {
  const base = { reason: "x", idempotencyKey: key };
  const code = (body: Record<string, unknown>, id = firearm) => { const parsed = parseCustodyTransferRequest(id, body); return parsed.ok ? "ok" : parsed.code; };
  assert.equal(code({ ...base, toHolderType: "VAULT" }), "invalid_destination");
  assert.equal(code({ ...base, toHolderType: "OFFICER" }), "invalid_officer");
  assert.equal(code({ ...base, toHolderType: "OFFICER", toHolderUserId: officer, toStorageLocationId: location }), "invalid_officer");
  assert.equal(code({ ...base, toHolderType: "SECURE_STORAGE" }), "invalid_storage_location");
  assert.equal(code({ ...base, toHolderType: "SECURE_STORAGE", toStorageLocationId: location, toHolderUserId: officer }), "invalid_storage_location");
  assert.equal(code({ toHolderType: "SECURE_STORAGE", toStorageLocationId: location, idempotencyKey: key, reason: "  " }), "reason_required");
  assert.equal(code({ ...base, toHolderType: "SECURE_STORAGE", toStorageLocationId: location, idempotencyKey: "nope" }), "invalid_idempotency_key");
  assert.equal(code({ ...base, toHolderType: "SECURE_STORAGE", toStorageLocationId: location }, "not-a-uuid"), "invalid_firearm");
});

test("SV-28: the page cannot build a request without a reason, a location, or an officer", () => {
  assert.throws(() => custodyTransferRequest({ direction: "CHECK_IN", reason: "x", idempotencyKey: key }), /secure-storage location/);
  assert.throws(() => custodyTransferRequest({ direction: "CHECK_OUT", reason: "x", idempotencyKey: key }), /officer/);
  assert.throws(() => custodyTransferRequest({ direction: "CHECK_OUT", toHolderUserId: officer, reason: " ", idempotencyKey: key }), /reason is required/);
});

test("SV-28: the route requires the permission 028 checks for the destination", () => {
  assert.deepEqual(custodyTransferPermissions("OFFICER"), ["firearm_custody.check_out", "manage_firearms"]);
  assert.deepEqual(custodyTransferPermissions("SECURE_STORAGE"), ["firearm_custody.check_in", "manage_firearms"]);
});

const now = new Date("2026-10-22T12:00:00Z");
const ops = { canCheckInPermission: true, canCheckOutPermission: true, assignedToUserId: officer, restrictions: [], holderType: "OFFICER", holderUserId: officer, now };

test("SV-28: ordinary operations follow the firearm's state", () => {
  assert.deepEqual(custodyTransferOperations(ops), { canCheckIn: true, canCheckOut: false, checkOutToUserId: officer });
  assert.deepEqual(custodyTransferOperations({ ...ops, holderType: "SECURE_STORAGE", holderUserId: null }), { canCheckIn: false, canCheckOut: true, checkOutToUserId: officer });
  // No custody recorded yet: either direction initializes it (028 INITIALIZE).
  assert.deepEqual(custodyTransferOperations({ ...ops, holderType: null, holderUserId: null }), { canCheckIn: true, canCheckOut: true, checkOutToUserId: officer });
  // Held by someone other than the assignee: it can be returned to the assignee.
  assert.equal(custodyTransferOperations({ ...ops, holderUserId: "20000000-0000-4000-8000-000000000002" }).canCheckOut, true);
});

test("SV-28: ordinary operations need the permission, an assignee for check-out, and no in-effect no-possession restriction", () => {
  assert.deepEqual(custodyTransferOperations({ ...ops, canCheckInPermission: false, canCheckOutPermission: false, holderType: null }), { canCheckIn: false, canCheckOut: false, checkOutToUserId: officer });
  assert.equal(custodyTransferOperations({ ...ops, assignedToUserId: null, holderType: "SECURE_STORAGE" }).canCheckOut, false);
  const noCarry = { is_active: true, restriction_type: "no_carry", no_possession_permitted: true, effective_start: "2026-01-01T00:00:00Z", expires_at: null };
  assert.equal(custodyTransferOperations({ ...ops, holderType: "SECURE_STORAGE", restrictions: [noCarry] }).canCheckOut, false);
  assert.equal(custodyTransferOperations({ ...ops, holderType: "SECURE_STORAGE", restrictions: [{ ...noCarry, expires_at: "2026-10-01T00:00:00Z" }] }).canCheckOut, true);
  assert.equal(custodyTransferOperations({ ...ops, holderType: "SECURE_STORAGE", restrictions: [{ ...noCarry, is_active: false }] }).canCheckOut, true);
  // Duty Only does not prohibit possession (028): the assignee may receive it.
  assert.equal(custodyTransferOperations({ ...ops, holderType: "SECURE_STORAGE", restrictions: [{ ...noCarry, restriction_type: "duty_only", no_possession_permitted: false }] }).canCheckOut, true);
});

test("SV-28: the page uses the restricted operation where the caller may perform it, otherwise the ordinary transfer", () => {
  assert.deepEqual(custodyPageActions(undefined), { checkIn: null, checkOut: null });
  assert.deepEqual(custodyPageActions({ canCheckIn: true, canCheckOut: false, transfer: { canCheckIn: true, canCheckOut: true } }), { checkIn: "restricted", checkOut: "transfer" });
  assert.deepEqual(custodyPageActions({ canCheckIn: false, canCheckOut: false, transfer: { canCheckIn: true, canCheckOut: false } }), { checkIn: "transfer", checkOut: null });
  // An older server without `transfer` keeps the UX-RB behaviour.
  assert.deepEqual(custodyPageActions({ canCheckIn: false, canCheckOut: true }), { checkIn: null, checkOut: "restricted" });
});

test("SV-28: 028's refusals become clear 4xx messages", () => {
  assert.deepEqual(custodyTransferFailure({ code: "42501", message: "active possession restriction prohibits checkout" }), { status: 409, error: "This firearm is restricted No Carry and cannot be checked out to an officer." });
  assert.deepEqual(custodyTransferFailure({ code: "42501", message: "custody permission required" }), { status: 403, error: "You do not have permission for this custody transfer." });
  assert.deepEqual(custodyTransferFailure({ code: "42501", message: "firearm unavailable" }), { status: 404, error: "This firearm is not available in your agency." });
  assert.deepEqual(custodyTransferFailure({ code: "22023", message: "custody officer unavailable" }), { status: 400, error: "The officer is not an active member of this agency." });
  assert.deepEqual(custodyTransferFailure({ code: "22023", message: "storage location unavailable" }), { status: 400, error: "Choose an active secure-storage location." });
  assert.deepEqual(custodyTransferFailure({ code: "22023", message: "something new" }), { status: 400, error: "something new" });
  assert.deepEqual(custodyTransferFailure({ code: "XX000", message: "" }), { status: 409, error: "Custody could not be updated." });
});

test("SV-28: history describes ordinary transfers with their reason and notes", () => {
  assert.equal(custodyEventSummary({ action_type: "TRANSFER", reason: "End of shift", notes: "Locker 4", to_holder_type: "SECURE_STORAGE" }), "Checked in to secure storage · End of shift — Locker 4");
  assert.equal(custodyEventSummary({ action_type: "TRANSFER", reason: "Issued for patrol", notes: null, to_holder_type: "OFFICER" }), "Checked out to officer · Issued for patrol");
  assert.equal(custodyEventSummary({ action_type: "INITIALIZE", reason: "Inventory", notes: null, to_holder_type: "SECURE_STORAGE" }), "Custody first recorded in secure storage · Inventory");
  // Restricted (031) events keep their wording.
  assert.equal(custodyEventSummary({ action_type: "TRANSFER", reason: "CHECK_OUT", notes: null, to_holder_type: "OFFICER" }), "Returned to assigned officer");
});
