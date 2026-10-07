import assert from "node:assert/strict";

export const ACCOUNT = "559054714699";
export const REGION = "us-east-1";
export const STACK = "tracepoint-staging-database";
export const LEASE_TAGS = new Set(["ExpiresAfterUTC", "LeaseOwner", "LeaseReference"]);

export function validateLease({ expiresAfterUtc, leaseOwner, leaseReference }, now = Date.now()) {
  const expiry = Date.parse(expiresAfterUtc ?? "");
  assert.ok(Number.isFinite(expiry) && expiry > now + 30 * 60_000 && expiry <= now + 7 * 24 * 60 * 60_000, "LEASE_EXPIRY_OUT_OF_BOUNDS");
  assert.match(leaseOwner ?? "", /^[A-Za-z0-9][A-Za-z0-9 .@_-]{2,79}$/, "LEASE_OWNER_INVALID");
  assert.match(leaseReference ?? "", /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/, "LEASE_REFERENCE_INVALID");
  return new Date(expiry).toISOString();
}

export function assertLeaseOnlyChangeSet(changes) {
  assert.ok(Array.isArray(changes) && changes.length > 0, "LEASE_CHANGESET_EMPTY");
  for (const item of changes ?? []) {
    const change = item.ResourceChange ?? item;
    assert.equal(change.Action, "Modify", "LEASE_CHANGE_MUST_MODIFY_ONLY");
    assert.equal(change.Replacement ?? "False", "False", "LEASE_REPLACEMENT_FORBIDDEN");
    assert.ok(typeof change.ResourceType === "string" && typeof change.LogicalResourceId === "string", "LEASE_RESOURCE_SCOPE_FORBIDDEN");
    const details = change.Details ?? [];
    assert.ok(details.length > 0, "LEASE_CHANGE_DETAILS_REQUIRED");
    for (const detail of details) {
      const target = detail.Target ?? {};
      assert.equal(target.Attribute, "Tags", "LEASE_NON_TAG_CHANGE_FORBIDDEN");
      assert.ok(LEASE_TAGS.has(target.Name), "LEASE_UNAPPROVED_TAG_FORBIDDEN");
    }
  }
}
