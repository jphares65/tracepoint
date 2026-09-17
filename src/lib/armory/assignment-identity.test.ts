import assert from "node:assert/strict";
import test from "node:test";

import {
  getAssignedOfficerContext,
  getAssignedOfficerDisplayName,
} from "./assignment-identity.ts";

test("formats assigned personnel with badge and unit context", () => {
  const assignment = {
    assigned_to_name: "Sarah Kim",
    assigned_to_badge_number: "303",
    assigned_to_unit_name: "Patrol Division",
  };

  assert.equal(getAssignedOfficerContext(assignment), "#303 · Patrol Division");
  assert.equal(
    getAssignedOfficerDisplayName(assignment),
    "Sarah Kim — #303 · Patrol Division",
  );
});
