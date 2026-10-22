import assert from "node:assert/strict";
import test from "node:test";

import {
  custodyEventSummary,
  parseRestrictedCustodyRequest,
  restrictedCustodyOperations,
  restrictedCustodyRequest,
} from "./restricted-custody.ts";

const firearm = "30000000-0000-4000-8000-000000000001";
const key = "60000000-0000-4000-8000-000000000001";
const location = "50000000-0000-4000-8000-000000000001";

test("UX-RB-4 defect (RC 5b6cc00): the record page's old body is refused by the route contract", () => {
  const oldBody = { toHolderType: "SECURE_STORAGE", toHolderUserId: null, toStorageLocationId: location, reason: "End of shift", notes: null, idempotencyKey: key, administrativeCorrection: false };
  assert.deepEqual(parseRestrictedCustodyRequest(firearm, oldBody), { ok: false, error: "A valid firearm, restricted custody action, and idempotency key are required." });
});

test("UX-RB-4: the page's request is accepted by the route in both directions", () => {
  const checkIn = restrictedCustodyRequest({ action: "CHECK_IN", storageLocationId: location, reason: " End of shift ", notes: "Locker 4", idempotencyKey: key });
  assert.deepEqual(parseRestrictedCustodyRequest(firearm, checkIn), { ok: true, action: "CHECK_IN", storageLocationId: location, notes: "End of shift — Locker 4", idempotencyKey: key });
  const checkOut = restrictedCustodyRequest({ action: "CHECK_OUT", storageLocationId: location, reason: "Start of shift", idempotencyKey: key });
  assert.deepEqual(parseRestrictedCustodyRequest(firearm, checkOut), { ok: true, action: "CHECK_OUT", storageLocationId: null, notes: "Start of shift", idempotencyKey: key });
});

test("UX-RB-4: the page cannot build a request without a reason or, for check-in, a location", () => {
  assert.throws(() => restrictedCustodyRequest({ action: "CHECK_OUT", reason: "  ", idempotencyKey: key }), /reason is required/);
  assert.throws(() => restrictedCustodyRequest({ action: "CHECK_IN", reason: "x", idempotencyKey: key }), /secure-storage location/);
});

const dutyOnly = { is_active: true, restriction_type: "duty_only", duty_only: true, no_possession_permitted: false, effective_start: "2026-01-01T00:00:00Z", expires_at: null };
const base = { assignedToUserId: "officer", userId: "officer", canManageRestrictedCustody: false, restrictions: [dutyOnly], holderType: "OFFICER", holderUserId: "officer", now: new Date("2026-10-22T12:00:00Z") };

test("UX-RB-4: operations mirror 031 — the assignee may check in an officer-held Duty Only firearm and check out a stored one", () => {
  assert.deepEqual(restrictedCustodyOperations(base), { canCheckIn: true, canCheckOut: false });
  assert.deepEqual(restrictedCustodyOperations({ ...base, holderType: "SECURE_STORAGE", holderUserId: null }), { canCheckIn: false, canCheckOut: true });
});

test("UX-RB-4: another officer needs manage_restricted_firearm_custody", () => {
  assert.deepEqual(restrictedCustodyOperations({ ...base, userId: "someone-else" }), { canCheckIn: false, canCheckOut: false });
  assert.deepEqual(restrictedCustodyOperations({ ...base, userId: "custodian", canManageRestrictedCustody: true }), { canCheckIn: true, canCheckOut: false });
});

test("UX-RB-4: no custody action without an assignment and an active, in-effect Duty Only restriction", () => {
  const none = { canCheckIn: false, canCheckOut: false };
  assert.deepEqual(restrictedCustodyOperations({ ...base, assignedToUserId: null }), none);
  assert.deepEqual(restrictedCustodyOperations({ ...base, restrictions: [] }), none);
  assert.deepEqual(restrictedCustodyOperations({ ...base, restrictions: [{ ...dutyOnly, restriction_type: "no_carry", no_possession_permitted: true, duty_only: false }] }), none);
  assert.deepEqual(restrictedCustodyOperations({ ...base, restrictions: [{ ...dutyOnly, is_active: false }] }), none);
  assert.deepEqual(restrictedCustodyOperations({ ...base, restrictions: [{ ...dutyOnly, effective_start: "2026-11-01T00:00:00Z" }] }), none);
  assert.deepEqual(restrictedCustodyOperations({ ...base, restrictions: [{ ...dutyOnly, expires_at: "2026-10-01T00:00:00Z" }] }), none);
  // Held by someone other than the assignee: 031 refuses CHECK_IN.
  assert.deepEqual(restrictedCustodyOperations({ ...base, holderUserId: "someone-else" }), none);
});

test("UX-RB-4: custody history shows what happened and the officer's reason and notes", () => {
  assert.equal(custodyEventSummary({ action_type: "TRANSFER", reason: "CHECK_IN", notes: "End of shift — Locker 4", to_holder_type: "SECURE_STORAGE" }), "Checked in to secure storage · End of shift — Locker 4");
  assert.equal(custodyEventSummary({ action_type: "TRANSFER", reason: "CHECK_OUT", notes: null, to_holder_type: "OFFICER" }), "Returned to assigned officer");
  // Events written by the earlier 028 transfer keep their free-text reason.
  assert.equal(custodyEventSummary({ action_type: "ADMINISTRATIVE_CORRECTION", reason: "Record fix", notes: "per sergeant", to_holder_type: "OFFICER" }), "Administrative correction · Record fix — per sergeant");
});
