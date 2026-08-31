import assert from "node:assert/strict";
import test from "node:test";

import {
  createQualificationHistoryRepository,
  mapQualificationHistoryRows,
  QUALIFICATION_HISTORY_FIELDS,
  QualificationHistoryAuthorizationError,
  QualificationHistoryRepositoryConfigurationError,
  QualificationHistoryRepositoryError,
  SupabaseQualificationHistoryRepository,
  type QualificationHistoryRow,
  type QualificationHistorySupabaseClient,
} from "./history-repository-core.ts";

type Call = { method: string; value: unknown };

function client(result: { data: QualificationHistoryRow[] | null; error: { message: string } | null }, calls: Call[]): QualificationHistorySupabaseClient {
  const query = {
    eq(column: string, value: string) {
      calls.push({ method: `eq:${column}`, value });
      return query;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.push({ method: `order:${column}`, value: options });
      return Promise.resolve(result);
    },
  };
  return {
    from(table) {
      calls.push({ method: "from", value: table });
      return {
        select(fields) {
          calls.push({ method: "select", value: fields });
          return query;
        },
      };
    },
  };
}

const row: QualificationHistoryRow = {
  id: "result-a",
  officer_user_id: "user-a",
  qualification_date: "2026-01-02",
  lighting_condition: null,
  score: "98",
  passed: true,
  record_origin: "historical_import",
  historical_qualification_type: "handgun",
  historical_instructor_name: "Synthetic Instructor",
  notes: null,
};

test("preserves the exact read-only Supabase query contract and tenant binding", async () => {
  const calls: Call[] = [];
  const repository = new SupabaseQualificationHistoryRepository(
    client({ data: [row], error: null }, calls),
    "department-a",
  );
  assert.deepEqual(await repository.listImportedHistory({ departmentId: "department-a" }), [row]);
  assert.deepEqual(calls, [
    { method: "from", value: "qualification_results" },
    { method: "select", value: QUALIFICATION_HISTORY_FIELDS },
    { method: "eq:department_id", value: "department-a" },
    { method: "eq:record_origin", value: "historical_import" },
    { method: "order:qualification_date", value: { ascending: false } },
  ]);
  assert.equal(calls.some((call) => ["insert", "update", "upsert", "delete"].includes(call.method)), false);
});

test("preserves empty-list not-found behavior", async () => {
  const repository = new SupabaseQualificationHistoryRepository(
    client({ data: null, error: null }, []),
    "department-a",
  );
  assert.deepEqual(await repository.listImportedHistory({ departmentId: "department-a" }), []);
});

test("preserves the route response field, null, and number mapping", () => {
  assert.deepEqual(mapQualificationHistoryRows([row]), [
    {
      id: "result-a",
      officerUserId: "user-a",
      qualificationDate: "2026-01-02",
      lightingCondition: null,
      score: 98,
      passed: true,
      recordOrigin: "historical_import",
      qualificationType: "handgun",
      instructorName: "Synthetic Instructor",
      notes: null,
    },
  ]);
  assert.deepEqual(mapQualificationHistoryRows([{ ...row, score: null }]), [
    {
      id: "result-a",
      officerUserId: "user-a",
      qualificationDate: "2026-01-02",
      lightingCondition: null,
      score: null,
      passed: true,
      recordOrigin: "historical_import",
      qualificationType: "handgun",
      instructorName: "Synthetic Instructor",
      notes: null,
    },
  ]);
});

test("rejects missing and cross-department context before querying", async () => {
  const calls: Call[] = [];
  assert.throws(
    () => new SupabaseQualificationHistoryRepository(client({ data: [], error: null }, calls), ""),
    QualificationHistoryAuthorizationError,
  );
  const repository = new SupabaseQualificationHistoryRepository(
    client({ data: [], error: null }, calls),
    "department-a",
  );
  await assert.rejects(
    repository.listImportedHistory({ departmentId: "department-b" }),
    QualificationHistoryAuthorizationError,
  );
  assert.deepEqual(calls, []);
});

test("maps provider failures without leaking raw provider messages", async () => {
  const repository = new SupabaseQualificationHistoryRepository(
    client({ data: null, error: { message: "synthetic internal relation detail" } }, []),
    "department-a",
  );
  await assert.rejects(
    repository.listImportedHistory({ departmentId: "department-a" }),
    (error) =>
      error instanceof QualificationHistoryRepositoryError &&
      error.message === "Qualification history could not be loaded." &&
      !error.message.includes("relation"),
  );
});

test("defaults to Supabase and fails closed for unsupported providers", () => {
  const supabase = client({ data: [], error: null }, []);
  assert.ok(createQualificationHistoryRepository(supabase, "department-a", {}) instanceof SupabaseQualificationHistoryRepository);
  assert.throws(
    () => createQualificationHistoryRepository(supabase, "department-a", { TRACEPOINT_DATA_PROVIDER: "aurora" }),
    QualificationHistoryRepositoryConfigurationError,
  );
});
