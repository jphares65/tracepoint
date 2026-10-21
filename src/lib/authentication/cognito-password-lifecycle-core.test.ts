import assert from "node:assert/strict";
import test from "node:test";

import { CognitoDirectoryError, type CognitoDirectoryUser } from "./cognito-admin-core.ts";
import { completeAssignPassword, completePasswordReset, finishPasswordOperation, type PreparedPasswordOperation } from "./cognito-password-lifecycle-core.ts";

const prepared: PreparedPasswordOperation = {
  userId: "user-1", providerUsername: "provider-user-1", providerSubject: "subject-1", issuer: "issuer", email: "officer@example.test", identityState: "active",
};
const confirmed: CognitoDirectoryUser = { username: "provider-user-1", subject: "subject-1", email: "officer@example.test", emailVerified: true, enabled: true, status: "CONFIRMED" };

function harness(overrides: Partial<Record<"get" | "setPermanentPassword" | "globalSignOut" | "beginPasswordReset", () => Promise<unknown>>> = {}) {
  const calls: string[] = [];
  const finishes: Array<[string, boolean, string | undefined, boolean | undefined]> = [];
  const step = (name: keyof typeof overrides, result: unknown) => async () => {
    calls.push(name);
    if (overrides[name]) return overrides[name]!();
    return result;
  };
  const directory = {
    get: step("get", confirmed) as () => Promise<CognitoDirectoryUser>,
    setPermanentPassword: step("setPermanentPassword", undefined) as () => Promise<void>,
    globalSignOut: step("globalSignOut", undefined) as () => Promise<void>,
    beginPasswordReset: step("beginPasswordReset", undefined) as () => Promise<void>,
  };
  const finish = async (operationId: string, succeeded: boolean, errorCode?: string, providerUnchanged?: boolean) => {
    finishes.push([operationId, succeeded, errorCode, providerUnchanged]);
  };
  return { calls, finishes, directory, finish };
}

const reject = (error: unknown) => async () => { throw error; };

test("reset refusals before any Cognito write are recorded as provider-unchanged failures", async () => {
  for (const [user, code] of [
    [{ ...confirmed, status: "FORCE_CHANGE_PASSWORD" }, "initial_password_required"],
    [{ ...confirmed, status: "UNCONFIRMED" }, "recovery_unavailable"],
    [{ ...confirmed, emailVerified: false }, "recovery_unavailable"],
    [{ ...confirmed, email: "other@example.test" }, "conflict"],
  ] as const) {
    const h = harness({ get: async () => user });
    await assert.rejects(completePasswordReset("op", prepared, h.directory, h.finish));
    assert.deepEqual(h.calls, ["get"], `no write for ${code}`);
    assert.deepEqual(h.finishes, [["op", false, code, true]]);
  }
  const unavailable = harness({ get: reject(new Error("network")) });
  await assert.rejects(completePasswordReset("op", prepared, unavailable.directory, unavailable.finish));
  assert.deepEqual(unavailable.finishes, [["op", false, "provider_unavailable", true]]);
});

test("reset failures once a Cognito write may have been attempted stay uncertain", async () => {
  for (const failing of ["globalSignOut", "beginPasswordReset"] as const) {
    const h = harness({ [failing]: reject(new CognitoDirectoryError("unavailable")) });
    await assert.rejects(completePasswordReset("op", prepared, h.directory, h.finish));
    assert.deepEqual(h.finishes, [["op", false, "unavailable", false]], failing);
  }
});

test("assign refusals before the password write are provider-unchanged; later failures are not", async () => {
  const conflict = harness({ get: async () => ({ ...confirmed, enabled: false }) });
  await assert.rejects(completeAssignPassword("op", prepared, "Synthetic-Password-1", conflict.directory, conflict.finish));
  assert.deepEqual(conflict.calls, ["get"]);
  assert.deepEqual(conflict.finishes, [["op", false, "conflict", true]]);

  for (const failing of ["setPermanentPassword", "globalSignOut"] as const) {
    const h = harness({ [failing]: reject(new CognitoDirectoryError("unavailable")) });
    await assert.rejects(completeAssignPassword("op", { ...prepared, identityState: "pending" }, "Synthetic-Password-1", h.directory, h.finish));
    assert.deepEqual(h.finishes, [["op", false, "unavailable", false]], failing);
  }
});

test("a failure recording success after Cognito writes is never provider-unchanged", async () => {
  const h = harness();
  let first = true;
  const finish = async (operationId: string, succeeded: boolean, errorCode?: string, providerUnchanged?: boolean) => {
    h.finishes.push([operationId, succeeded, errorCode, providerUnchanged]);
    if (first) { first = false; throw new Error("database unavailable"); }
  };
  await assert.rejects(completeAssignPassword("op", prepared, "Synthetic-Password-1", h.directory, finish));
  assert.deepEqual(h.finishes, [["op", true, undefined, undefined], ["op", false, "provider_unavailable", false]]);
});

test("successful operations finish once, with no failure classification", async () => {
  const assign = harness();
  await completeAssignPassword("op", prepared, "Synthetic-Password-1", assign.directory, assign.finish);
  assert.deepEqual(assign.calls, ["get", "setPermanentPassword", "globalSignOut"]);
  assert.deepEqual(assign.finishes, [["op", true, undefined, undefined]]);
  const reset = harness();
  await completePasswordReset("op", prepared, reset.directory, reset.finish);
  assert.deepEqual(reset.calls, ["get", "globalSignOut", "beginPasswordReset"]);
  assert.deepEqual(reset.finishes, [["op", true, undefined, undefined]]);
});

test("finish keeps the three-argument call and falls back only when the four-argument form is absent", async () => {
  const sent: Array<[string, unknown[]]> = [];
  const record = (failFour?: unknown) => async (sql: string, values: unknown[]) => {
    sent.push([sql, values]);
    if (failFour && values.length === 4) throw failFour;
  };
  await finishPasswordOperation(record(), "op", true);
  await finishPasswordOperation(record(), "op", false, "unavailable", false);
  assert.deepEqual(sent.splice(0), [
    ["select tracepoint_auth.finish_cognito_password_operation($1,$2,$3)", ["op", true, null]],
    ["select tracepoint_auth.finish_cognito_password_operation($1,$2,$3)", ["op", false, "unavailable"]],
  ]);
  await finishPasswordOperation(record(), "op", false, "initial_password_required", true);
  assert.deepEqual(sent.splice(0), [["select tracepoint_auth.finish_cognito_password_operation($1,$2,$3,$4)", ["op", false, "initial_password_required", true]]]);

  await finishPasswordOperation(record(Object.assign(new Error("function does not exist"), { code: "42883" })), "op", false, "initial_password_required", true);
  assert.deepEqual(sent.splice(0).map(([, values]) => values.length), [4, 3]);

  await assert.rejects(finishPasswordOperation(record(Object.assign(new Error("denied"), { code: "42501" })), "op", false, "initial_password_required", true), /denied/);
  assert.equal(sent.splice(0).length, 1);
});
