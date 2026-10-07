import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLease, validateStoredLease } from "./database-lease-governance-core.mjs";

const now = Date.parse("2026-10-07T00:00:00Z");
const valid = { expiresAfterUtc: "2026-10-09T00:00:00Z", leaseOwner: "github-release", leaseReference: "github:123:1" };

test("accepts a valid two-day run-bound lease", () => assert.equal(validateLease(valid, now), "2026-10-09T00:00:00.000Z"));
test("rejects bounded-invalid lease inputs", () => {
  for (const patch of [{ expiresAfterUtc: "2026-10-07T00:30:00Z" }, { expiresAfterUtc: "2026-10-14T00:00:01Z" }, { leaseOwner: "" }, { leaseOwner: "!bad" }, { leaseReference: "" }, { leaseReference: "bad value" }]) assert.throws(() => validateLease({ ...valid, ...patch }, now));
});
test("accepts an unexpired stored lease bounded to seven days", () => assert.deepEqual(validateStoredLease(valid, now), { ...valid, expiresAfterUtc: "2026-10-09T00:00:00.000Z" }));
test("stored lease fails closed for missing, malformed, expired, oversized, and non-governance JSON", () => {
  for (const candidate of [undefined, null, [], { ...valid, expiresAfterUtc: "bad" }, { ...valid, expiresAfterUtc: "2026-10-06T23:59:59Z" }, { ...valid, expiresAfterUtc: "2026-10-14T00:00:01Z" }, { ...valid, leaseOwner: "" }, { ...valid, leaseReference: "bad value" }, { ...valid, extra: "no" }]) assert.throws(() => validateStoredLease(candidate, now));
});
