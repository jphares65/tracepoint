import assert from "node:assert/strict";
import test from "node:test";
import { validateConditionReport } from "./condition-report-policy.ts";

const base = { condition: "damaged", notes: "Broken lens", lifecycle: "active", custody: "available" as const, canManage: false };
test("an available asset may be reported damaged without issuing custody", () => {
  assert.deepEqual(validateConditionReport(base), { ok: true });
});
test("reporting requires an actual defect with explanatory notes", () => {
  assert.equal(validateConditionReport({ ...base, condition: "serviceable" }).ok, false);
  assert.equal(validateConditionReport({ ...base, notes: " " }).ok, false);
  assert.equal(validateConditionReport({ ...base, notes: "x".repeat(1001) }).ok, false);
});
test("cannot change another person's assigned equipment unless an equipment manager", () => {
  const elsewhere = { ...base, custody: "assigned" as const };
  assert.deepEqual(validateConditionReport(elsewhere), { ok: false, status: 403, message: "Only the current custodian or an equipment manager can report this assigned asset." });
  assert.deepEqual(validateConditionReport({ ...elsewhere, canManage: true }), { ok: true });
});
test("inactive assets require review, not another condition mutation", () => {
  assert.equal(validateConditionReport({ ...base, lifecycle: "out_of_service" }).ok, false);
});
