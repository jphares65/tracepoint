import assert from "node:assert/strict";
import test from "node:test";
import { TenantBoundTrainingReadRepository, TrainingReadAuthorizationError, TrainingReadRepositoryError, requireTrainingReadProvider, type TrainingReadDataSource, type TrainingResult } from "./read-repository-core.ts";
import { SupabaseTrainingReadDataSource, type TrainingClient } from "./read-repository-supabase.ts";
const ok = (data: unknown): TrainingResult => ({ data, error: null });
function source(overrides: Partial<TrainingReadDataSource> = {}) { const empty = () => Promise.resolve(ok([])); return { listCertifications: empty, listMemberships: empty, listTypes: empty, listRequirements: empty, listProfiles: empty, ...overrides } satisfies TrainingReadDataSource; }

test("training reads reject cross-tenant context before provider I/O", async () => {
  let calls = 0; const repository = new TenantBoundTrainingReadRepository(source({ listCertifications: () => { calls += 1; return Promise.resolve(ok([])); } }), "dept-a");
  await assert.rejects(repository.getCertificationWorkspace("dept-b"), TrainingReadAuthorizationError);
  assert.equal(calls, 0);
});

test("certification workspace preserves mapping, sorting, defaults, and empty-profile short circuit", async () => {
  let profileCalls = 0;
  const repository = new TenantBoundTrainingReadRepository(source({ listCertifications: () => Promise.resolve(ok([{ id: "cert-1" }])), listMemberships: () => Promise.resolve(ok([{ user_id: "u2", rank_title: "Sergeant", badge_number: null }, { user_id: "u1", is_active: false }])), listTypes: () => Promise.resolve(ok([{ id: "type-1" }])), listRequirements: () => Promise.resolve(ok([{ id: "req-1" }])), listProfiles: (ids) => { profileCalls += 1; assert.deepEqual(ids, ["u2", "u1"]); return Promise.resolve(ok([{ id: "u1", full_name: "Alpha" }])); } }), "dept-a");
  const data = await repository.getCertificationWorkspace("dept-a");
  assert.deepEqual(data.members, [{ user_id: "u1", full_name: "Alpha", badge_number: null, rank_title: null, is_active: false }, { user_id: "u2", full_name: "Sergeant", badge_number: null, rank_title: "Sergeant", is_active: true }]);
  assert.equal(profileCalls, 1); assert.deepEqual(data.certifications, [{ id: "cert-1" }]);
  const empty = new TenantBoundTrainingReadRepository(source({ listProfiles: () => { profileCalls += 1; return Promise.resolve(ok([])); } }), "dept-a");
  await empty.getCertificationWorkspace("dept-a"); assert.equal(profileCalls, 1);
});

test("training reads preserve provider errors", async () => {
  const repository = new TenantBoundTrainingReadRepository(source({ listTypes: () => Promise.resolve({ data: null, error: { message: "types failed" } }) }), "dept-a");
  await assert.rejects(repository.getCertificationWorkspace("dept-a"), (error: unknown) => error instanceof TrainingReadRepositoryError && error.message === "types failed");
});

test("Supabase training adapter preserves exact query contracts", async () => {
  const calls: string[] = []; const query = new Proxy({ then: (resolve: (value: TrainingResult) => void) => resolve(ok([])) }, { get(target, property) { if (property === "then") return target.then; return (...args: unknown[]) => { calls.push(`${String(property)}:${JSON.stringify(args)}`); return query; }; } });
  const client = { from(table: string) { calls.push(`from:${table}`); return query; } } as unknown as TrainingClient; const adapter = new SupabaseTrainingReadDataSource(client);
  await adapter.listCertifications("dept-a"); await adapter.listMemberships("dept-a"); await adapter.listTypes("dept-a"); await adapter.listRequirements("dept-a", "fields"); await adapter.listRequirements("dept-a", "*", "created_at"); await adapter.listProfiles(["u1"]);
  assert.deepEqual(calls, ["from:training_certifications", 'select:["*"]', 'eq:["department_id","dept-a"]', 'eq:["is_active",true]', 'order:["expiration_date",{"ascending":true,"nullsFirst":false}]', "from:department_memberships", 'select:["user_id,badge_number,rank_title,is_active"]', 'eq:["department_id","dept-a"]', 'eq:["is_active",true]', "from:certification_types", 'select:["id,department_id,name,description,category,issuing_organization,expiration_required,default_valid_days,default_due_soon_days,is_active"]', 'eq:["department_id","dept-a"]', 'eq:["is_active",true]', 'order:["category",{"ascending":true}]', 'order:["name",{"ascending":true}]', "from:department_certification_requirements", 'select:["fields"]', 'eq:["department_id","dept-a"]', 'eq:["is_active",true]', "from:department_certification_requirements", 'select:["*"]', 'eq:["department_id","dept-a"]', 'order:["created_at"]', "from:profiles", 'select:["id,full_name"]', 'in:["id",["u1"]]']);
});

test("training provider selection fails closed", () => { assert.equal(requireTrainingReadProvider(undefined), "supabase"); assert.throws(() => requireTrainingReadProvider("aurora"), /Unsupported data provider/); });
