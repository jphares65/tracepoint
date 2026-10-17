import assert from "node:assert/strict";
import test from "node:test";

import { assertPolicyPublishable, policySections, policyText, unresolvedPolicyMarkers } from "./policy-content.ts";

test("a policy with unresolved owner markers cannot be published by a production build", () => {
  const draft = "Contact [[OWNER: privacy email]].";
  assert.deepEqual(unresolvedPolicyMarkers(draft), ["[[OWNER: privacy email]]"]);
  assert.throws(() => assertPolicyPublishable("production", draft), /cannot be published/);
  assert.doesNotThrow(() => assertPolicyPublishable("development", draft));
  assert.doesNotThrow(() => assertPolicyPublishable("production", "Contact privacy@example.invalid."));
});

test("privacy policy covers the disclosures both app stores review", () => {
  const ids = policySections.map(section => section.id);
  for (const id of ["collect", "mobile", "use", "share", "security", "retention", "rights", "children", "contact"]) assert.ok(ids.includes(id), id);
  assert.match(policyText(), /do not sell personal information/i);
  assert.match(policyText(), /Amazon Web Services/);
});
