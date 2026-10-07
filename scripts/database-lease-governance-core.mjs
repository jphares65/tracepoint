import assert from "node:assert/strict";

export const ACCOUNT = "559054714699";
export const REGION = "us-east-1";
export const LEASE_PARAMETER = "/tracepoint/staging/database-release-lease";
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9 .@_-]{2,79}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;

export function validateLease({ expiresAfterUtc, leaseOwner, leaseReference }, now = Date.now()) {
  const expiry = Date.parse(expiresAfterUtc ?? "");
  assert.ok(UTC_TIMESTAMP.test(expiresAfterUtc ?? "") && Number.isFinite(expiry) && expiry > now + 30 * 60_000 && expiry <= now + 7 * 24 * 60 * 60_000, "LEASE_EXPIRY_OUT_OF_BOUNDS");
  assert.match(leaseOwner ?? "", OWNER, "LEASE_OWNER_INVALID");
  assert.match(leaseReference ?? "", REFERENCE, "LEASE_REFERENCE_INVALID");
  return new Date(expiry).toISOString();
}

export function validateStoredLease(value, now = Date.now()) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "LEASE_VALUE_INVALID");
  assert.deepEqual(Object.keys(value).sort(), ["expiresAfterUtc", "leaseOwner", "leaseReference"], "LEASE_VALUE_SHAPE_INVALID");
  const expiry = Date.parse(value.expiresAfterUtc ?? "");
  assert.ok(UTC_TIMESTAMP.test(value.expiresAfterUtc ?? "") && Number.isFinite(expiry) && expiry > now && expiry <= now + 7 * 24 * 60 * 60_000, "LEASE_EXPIRY_INVALID");
  assert.match(value.leaseOwner ?? "", OWNER, "LEASE_OWNER_INVALID");
  assert.match(value.leaseReference ?? "", REFERENCE, "LEASE_REFERENCE_INVALID");
  return { expiresAfterUtc: new Date(expiry).toISOString(), leaseOwner: value.leaseOwner, leaseReference: value.leaseReference };
}
