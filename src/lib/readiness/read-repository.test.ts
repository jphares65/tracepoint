import assert from "node:assert/strict";
import test from "node:test";
import { ReadinessAuthorizationError, ReadinessRepositoryConfigurationError, ReadinessRepositoryError, requireReadinessProvider, TenantBoundReadinessRepository, type ReadinessDataSource, type ReadinessResult } from "./read-repository-core.ts";
import { SupabaseReadinessDataSource, type ReadinessClient, type ReadinessQuery } from "./read-repository-supabase.ts";

const ok = (data: Record<string, unknown>[] = []): ReadinessResult => ({ data, error: null });
function source(overrides: Partial<ReadinessDataSource> = {}): ReadinessDataSource {
  return { async listEquipmentMembers() { return ok(); }, async listEquipmentTypes() { return ok(); }, async listEquipmentRequirements() { return ok(); }, async listEquipmentAssets() { return ok(); }, async listCertificationMembers() { return ok(); }, async listCertificationTypes() { return ok(); }, async listCertificationRequirements() { return ok(); }, async listCertificationCredentials() { return ok(); }, async listProfiles() { return ok(); }, ...overrides };
}
test("rejects missing and cross-tenant context before provider I/O", async () => {
  let calls = 0; const data = source({ async listEquipmentMembers() { calls += 1; return ok(); } });
  assert.throws(() => new TenantBoundReadinessRepository(data, ""), ReadinessAuthorizationError);
  const repository = new TenantBoundReadinessRepository(data, "agency-a");
  await assert.rejects(repository.getEquipmentReadiness({ departmentId: "agency-b", userId: "user-a", canViewDepartment: true }), ReadinessAuthorizationError);
  await assert.rejects(repository.getCertificationReadiness({ departmentId: "agency-b" }), ReadinessAuthorizationError);
  assert.equal(calls, 0);
});
test("preserves self-only equipment visibility and profile fallbacks", async () => {
  const memberInputs: unknown[] = []; const assetInputs: unknown[] = [];
  const repository = new TenantBoundReadinessRepository(source({
    async listEquipmentMembers(departmentId, userId) { memberInputs.push({ departmentId, userId }); return ok([{ user_id: "user-a", rank_title: "Officer" }]); },
    async listEquipmentAssets(departmentId, userId) { assetInputs.push({ departmentId, userId }); return ok(); },
    async listProfiles() { return ok(); },
  }), "agency-a");
  const result = await repository.getEquipmentReadiness({ departmentId: "agency-a", userId: "user-a", canViewDepartment: false });
  assert.equal(result.scope, "self"); assert.deepEqual(memberInputs, [{ departmentId: "agency-a", userId: "user-a" }]); assert.deepEqual(assetInputs, memberInputs);
  assert.equal(result.summary.readinessPercent, 100); assert.deepEqual(result.rows, []);
});
test("aggregates certification readiness and skips empty profile reads", async () => {
  let profilesCalled = false;
  const repository = new TenantBoundReadinessRepository(source({ async listProfiles() { profilesCalled = true; return ok(); } }), "agency-a");
  const result = await repository.getCertificationReadiness({ departmentId: "agency-a" });
  assert.equal(profilesCalled, false); assert.deepEqual(result.rows, []); assert.equal(result.summary.readinessPercent, 100);
});
test("preserves provider error messages", async () => {
  const repository = new TenantBoundReadinessRepository(source({ async listEquipmentTypes() { return { data: null, error: { message: "exact provider error" } }; } }), "agency-a");
  await assert.rejects(repository.getEquipmentReadiness({ departmentId: "agency-a", userId: "user-a", canViewDepartment: true }), (error) => error instanceof ReadinessRepositoryError && error.message === "exact provider error");
});
test("keeps exact Supabase query filters and self visibility in the thin adapter", async () => {
  const calls: string[] = []; const client: ReadinessClient = { from(table) { calls.push(`from:${table}`); const query = { select(fields: string) { calls.push(`select:${fields}`); return query; }, eq(column: string, value: unknown) { calls.push(`eq:${column}:${String(value)}`); return query; }, neq(column: string, value: unknown) { calls.push(`neq:${column}:${String(value)}`); return query; }, in(column: string, values: string[]) { calls.push(`in:${column}:${values.join(",")}`); return query; }, then(resolve: (value: ReadinessResult) => unknown) { return Promise.resolve(ok()).then(resolve); } }; return query as ReadinessQuery; } };
  const adapter = new SupabaseReadinessDataSource(client);
  await adapter.listEquipmentMembers("agency-a", "user-a"); await adapter.listEquipmentTypes("agency-a"); await adapter.listEquipmentRequirements("agency-a"); await adapter.listEquipmentAssets("agency-a", "user-a");
  await adapter.listCertificationMembers("agency-a"); await adapter.listCertificationTypes("agency-a"); await adapter.listCertificationRequirements("agency-a"); await adapter.listCertificationCredentials("agency-a"); await adapter.listProfiles(["user-a"]);
  assert.equal(calls.filter((call) => call === "eq:department_id:agency-a").length, 8);
  assert.ok(calls.includes("eq:user_id:user-a")); assert.ok(calls.includes("eq:assigned_user_id:user-a")); assert.ok(calls.includes("neq:lifecycle_status:removed")); assert.ok(calls.includes("in:id:user-a"));
});
test("fails closed for unsupported providers", () => { assert.equal(requireReadinessProvider(undefined), "supabase"); assert.throws(() => requireReadinessProvider("aurora"), ReadinessRepositoryConfigurationError); });
