import assert from "node:assert/strict";
import test from "node:test";

import { passwordOperationContext } from "./cognito-password-operation-context.ts";

const actorUserId = "20000000-0000-4000-8000-000000000001";
const departmentId = "10000000-0000-4000-8000-000000000001";

test("password operation carries an explicitly verified platform support context", () => {
  assert.deepEqual(passwordOperationContext({ actorUserId, departmentId, supportMode: true }), {
    subjectId: actorUserId,
    departmentId,
    supportMode: true,
  });
});

test("ordinary department password operation does not claim platform support", () => {
  assert.equal(passwordOperationContext({ actorUserId, departmentId }).supportMode, false);
  assert.equal(passwordOperationContext({ actorUserId, departmentId, supportMode: false }).supportMode, false);
});
