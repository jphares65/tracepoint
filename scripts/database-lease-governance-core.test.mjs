import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLeaseOnlyChangeSet, validateLease } from "./database-lease-governance-core.mjs";
const now = Date.parse("2026-10-07T00:00:00Z");
const valid = { expiresAfterUtc: "2026-10-09T00:00:00Z", leaseOwner: "github-release", leaseReference: "github:123:1" };
test("accepts a valid two-day run-bound lease", () => assert.equal(validateLease(valid, now), "2026-10-09T00:00:00.000Z"));
test("rejects bounded-invalid lease inputs", () => {
  for (const patch of [{ expiresAfterUtc: "2026-10-07T00:30:00Z" }, { expiresAfterUtc: "2026-10-14T00:00:01Z" }, { leaseOwner: "" }, { leaseOwner: "!bad" }, { leaseReference: "" }, { leaseReference: "bad value" }]) assert.throws(() => validateLease({ ...valid, ...patch }, now));
});
const lease = name => ({ ResourceChange: { Action: "Modify", Replacement: "False", ResourceType: "AWS::CloudFormation::Stack", LogicalResourceId: "tracepoint-staging-database", Details: [{ Target: { Attribute: "Tags", Name: name } }] } });
test("accepts only the three lease tags", () => assert.doesNotThrow(() => assertLeaseOnlyChangeSet([lease("ExpiresAfterUTC"), lease("LeaseOwner"), lease("LeaseReference")] )));
test("rejects non-lease changes and replacements", () => {
  const nonTag = attribute => [{ ResourceChange: { ...lease("LeaseOwner").ResourceChange, Details: [{ Target: { Attribute: attribute, Name: "DatabaseClass" } }] } }];
  for (const candidate of [
    [],
    [{ ResourceChange: { ...lease("LeaseOwner").ResourceChange, Action: "Add" } }],
    [{ ResourceChange: { ...lease("LeaseOwner").ResourceChange, Action: "Remove" } }],
    [{ ResourceChange: { ...lease("LeaseOwner").ResourceChange, Replacement: "True" } }],
    [lease("Backup")],
    nonTag("Properties"),
    nonTag("Parameters"),
    nonTag("Policy"),
  ]) assert.throws(() => assertLeaseOnlyChangeSet(candidate));
});
