/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { AgencyTrainingReadAuthorizationError, AgencyTrainingReadRepositoryError, mapAgencyTrainingEvent, requireAgencyTrainingReadProvider, TenantBoundAgencyTrainingReadRepository, type AgencyTrainingReadDataSource, type AgencyTrainingResult } from "./read-repository-core.ts";
import { EVENT_FIELDS, SupabaseAgencyTrainingReadDataSource } from "./read-repository-supabase.ts";

const result = (data: Record<string, any>[] = [], error: { message: string } | null = null): AgencyTrainingResult => ({ data, error });
function source(overrides: Partial<AgencyTrainingReadDataSource> = {}): AgencyTrainingReadDataSource {
  return { listInstructorMemberships: async () => result(), listProfiles: async () => result(), listRequirements: async () => result(), listEvents: async () => result(), ...overrides };
}

test("rejects missing and cross-tenant context before provider I/O", async () => {
  assert.throws(() => new TenantBoundAgencyTrainingReadRepository(source(), ""), AgencyTrainingReadAuthorizationError);
  let calls = 0;
  const repository = new TenantBoundAgencyTrainingReadRepository(source({ listEvents: async () => { calls += 1; return result(); } }), "dept-a");
  await assert.rejects(repository.listEvents({ departmentId: "dept-b" }), AgencyTrainingReadAuthorizationError);
  assert.equal(calls, 0);
});

test("preserves instructor mapping, sorting, fallbacks, and empty profile short-circuit", async () => {
  let profileCalls = 0;
  const empty = new TenantBoundAgencyTrainingReadRepository(source({ listProfiles: async () => { profileCalls += 1; return result(); } }), "dept-a");
  assert.deepEqual(await empty.listInstructors({ departmentId: "dept-a" }), []);
  assert.equal(profileCalls, 0);
  const repository = new TenantBoundAgencyTrainingReadRepository(source({
    listInstructorMemberships: async () => result([{ user_id: "2", rank_title: " Captain ", badge_number: " 9 ", unit_name: " A " }, { user_id: "1", rank_title: "Officer" }]),
    listProfiles: async (ids) => { assert.deepEqual(ids, ["2", "1"]); return result([{ id: "1", full_name: " Alice " }]); },
  }), "dept-a");
  assert.deepEqual(await repository.listInstructors({ departmentId: "dept-a" }), [
    { userId: "1", fullName: "Alice", badgeNumber: null, rankTitle: "Officer", unitName: null },
    { userId: "2", fullName: "Captain", badgeNumber: "9", rankTitle: "Captain", unitName: "A" },
  ]);
});

test("preserves event aggregation and empty/default values", () => {
  const mapped = mapAgencyTrainingEvent({ id: "e", topics: null, agency_training_attendees: [{ outcome_status: "passed" }, { outcome_status: "failed" }], agency_training_event_instructors: [{ user_id: "lead", display_name: "Lead", is_lead: true }, { user_id: "other", display_name: "Other", is_lead: false }] });
  assert.equal(mapped.attendeeCount, 2); assert.equal(mapped.completedCount, 1); assert.equal(mapped.instructorCount, 2); assert.equal(mapped.leadInstructor, "Lead"); assert.deepEqual(mapped.topics, []); assert.deepEqual(mapped.additionalInstructors, [{ userId: "other", displayName: "Other", organization: undefined, credentials: undefined, instructorRole: undefined }]);
});

test("preserves provider error messages and provider fail-closed behavior", async () => {
  const repository = new TenantBoundAgencyTrainingReadRepository(source({ listRequirements: async () => result([], { message: "requirements failed" }) }), "dept-a");
  await assert.rejects(repository.listRequirements({ departmentId: "dept-a" }), (error: unknown) => error instanceof AgencyTrainingReadRepositoryError && error.message === "requirements failed");
  assert.equal(requireAgencyTrainingReadProvider(undefined), "supabase");
  assert.throws(() => requireAgencyTrainingReadProvider("aurora"), /Unsupported data provider/);
});

test("keeps exact Supabase projections, tenant filters, and ordering", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const query: any = { select: (value: string) => (calls.push(["select", value]), query), eq: (column: string, value: unknown) => (calls.push(["eq", column, value]), query), in: (column: string, value: string[]) => (calls.push(["in", column, value]), query), order: (column: string, value: unknown) => (calls.push(["order", column, value]), query), then: (resolve: (value: AgencyTrainingResult) => void) => resolve(result()) };
  const adapter = new SupabaseAgencyTrainingReadDataSource({ from: (table: string) => (calls.push(["from", table]), query) });
  await adapter.listInstructorMemberships("dept-a"); await adapter.listProfiles(["u"]); await adapter.listRequirements("dept-a"); await adapter.listEvents("dept-a");
  assert.ok(calls.some((call) => call[0] === "select" && call[1] === EVENT_FIELDS));
  assert.ok(calls.some((call) => call[0] === "order" && call[1] === "requirement_name"));
  assert.ok(calls.some((call) => call[0] === "order" && call[1] === "starts_at"));
  assert.equal(calls.filter((call) => call[0] === "eq" && call[1] === "department_id" && call[2] === "dept-a").length, 3);
});
