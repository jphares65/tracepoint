import assert from "node:assert/strict";
import test from "node:test";
import { applyCognitoMembershipLifecycle, type MembershipLifecycleDirectory, type MembershipLifecycleStore } from "./cognito-membership-lifecycle-core.ts";

const input = { operationId: "operation", actorUserId: "actor", departmentId: "department", targetUserId: "target", active: false };

function fixture(shouldChangeProvider = true) {
  const calls: string[] = [];
  const store: MembershipLifecycleStore = {
    async prepare() { calls.push("prepare"); return { providerUsername: "provider-user", shouldChangeProvider }; },
    async finish(_id, succeeded) { calls.push(`finish:${succeeded}`); },
  };
  const directory: MembershipLifecycleDirectory = {
    async enable() { calls.push("enable"); },
    async globalSignOut() { calls.push("signout"); },
    async disable() { calls.push("disable"); },
  };
  return { calls, store, directory };
}

test("deactivation revokes provider sessions before disabling and committing", async () => {
  const value = fixture();
  await applyCognitoMembershipLifecycle(value.store, value.directory, input);
  assert.deepEqual(value.calls, ["prepare", "signout", "disable", "finish:true"]);
});

test("reactivation enables Cognito before database membership commit", async () => {
  const value = fixture();
  await applyCognitoMembershipLifecycle(value.store, value.directory, { ...input, active: true });
  assert.deepEqual(value.calls, ["prepare", "enable", "finish:true"]);
});

test("multi-department transitions leave the shared Cognito identity enabled", async () => {
  const value = fixture(false);
  const result = await applyCognitoMembershipLifecycle(value.store, value.directory, input);
  assert.equal(result.providerChanged, false);
  assert.deepEqual(value.calls, ["prepare", "finish:true"]);
});

test("provider failures leave an explicit compensation-required operation", async () => {
  const value = fixture();
  value.directory.disable = async () => { value.calls.push("disable"); throw new Error("private"); };
  await assert.rejects(applyCognitoMembershipLifecycle(value.store, value.directory, input), /could not be completed safely/);
  assert.deepEqual(value.calls, ["prepare", "signout", "disable", "finish:false"]);
});
