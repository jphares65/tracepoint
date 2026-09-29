import assert from "node:assert/strict";
import test from "node:test";
import { cognitoInviteAuthorizationContext } from "./cognito-invite-authorization-context";

const actorUserId = "10000000-0000-4000-8000-000000000001";
const departmentId = "20000000-0000-4000-8000-000000000002";

test("Cognito invitations retain explicit platform-support context", () => {
  assert.deepEqual(
    cognitoInviteAuthorizationContext({ actorUserId, departmentId, supportMode: true }),
    { subjectId: actorUserId, departmentId, supportMode: true },
  );
});

test("Cognito invitations do not manufacture platform-support context", () => {
  assert.deepEqual(
    cognitoInviteAuthorizationContext({ actorUserId, departmentId }),
    { subjectId: actorUserId, departmentId, supportMode: false },
  );
});
