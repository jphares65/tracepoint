import assert from "node:assert/strict";
import test from "node:test";
import { types as pgTypes } from "pg";
import { resolveStructuredBinding, type StructuredBinding } from "./structured-binding";
import { createDocumentQualificationHistoryRepository, DocumentQualificationHistoryAuthorizationError, DocumentQualificationHistoryRepository, DocumentQualificationHistoryRepositoryConfigurationError, type DocumentQualificationHistoryClient, type DocumentQualificationRow } from "./document-qualification-history";

const row: DocumentQualificationRow = { id: "q-1", officer_user_id: "person-1", qualification_date: "2026-01-01", score: "99", passed: true, historical_course_name: "HQC", historical_instructor_name: null, historical_qualification_type: "handgun" };
function client(member: boolean, calls: string[], rows: DocumentQualificationRow[] = [row]): DocumentQualificationHistoryClient { const from = (table: "department_memberships" | "qualification_results") => { if (table === "department_memberships") { const query = { eq(column: string, value: string | boolean) { calls.push(`${column}:${value}`); return query; }, maybeSingle: () => Promise.resolve({ data: member ? { user_id: "person-1" } : null, error: null }) }; return { select: () => query }; } const query = { eq(column: string, value: string) { calls.push(`${column}:${value}`); return query; }, order: () => Promise.resolve({ data: rows, error: null }) }; return { select: () => query }; }; return { from: from as DocumentQualificationHistoryClient["from"] }; }
test("history retrieval verifies membership then scopes qualifications to tenant and person", async () => { const calls: string[] = []; const records = await new DocumentQualificationHistoryRepository(client(true, calls), "department-1").getQualificationHistoryForDocumentContext({ personId: "person-1" }); assert.deepEqual(records, [{ id: "q-1", date: "2026-01-01", courseName: "HQC", result: "Pass", score: 99, firearmType: "handgun" }]); assert.deepEqual(calls, ["department_id:department-1", "user_id:person-1", "is_active:true", "department_id:department-1", "officer_user_id:person-1"]); });
test("cross-tenant people are rejected before qualification reads", async () => { const calls: string[] = []; await assert.rejects(() => new DocumentQualificationHistoryRepository(client(false, calls), "department-1").getQualificationHistoryForDocumentContext({ personId: "person-2" }), DocumentQualificationHistoryAuthorizationError); assert.deepEqual(calls, ["department_id:department-1", "user_id:person-2", "is_active:true"]); });
test("accepts the existing supabase and postgres provider modes", () => { assert.ok(createDocumentQualificationHistoryRepository(client(true, []), "department-1", { TRACEPOINT_DATA_PROVIDER: "postgres" }) instanceof DocumentQualificationHistoryRepository); assert.throws(() => createDocumentQualificationHistoryRepository(client(true, []), "department-1", { TRACEPOINT_DATA_PROVIDER: "other" }), DocumentQualificationHistoryRepositoryConfigurationError); });

/** node-postgres (the AWS-native runtime) returns DATE columns as Date objects, not text. */
const pgDate = (text: string) => pgTypes.getTypeParser(1082)(text) as Date;
test("history from node-postgres keeps every record's calendar date, year filter and order", async () => {
  const awsRows: DocumentQualificationRow[] = [
    { ...row, id: "q-dec", qualification_date: pgDate("2026-12-31") },
    { ...row, id: "q-sep", qualification_date: pgDate("2026-09-14") },
    { ...row, id: "q-jan", qualification_date: pgDate("2026-01-01") },
    { ...row, id: "q-old", qualification_date: pgDate("2025-12-31") },
  ];
  const records = await new DocumentQualificationHistoryRepository(client(true, [], awsRows), "department-1").getQualificationHistoryForDocumentContext({ personId: "person-1" });
  assert.deepEqual(records.map((record) => record.date), ["2026-12-31", "2026-09-14", "2026-01-01", "2025-12-31"]);
  const binding: StructuredBinding = { sourceType: "qualification_history", fillMode: "sequential_cells", ordering: "date_asc", maxRows: 4, overflowBehavior: "require_review", columnMappings: [{ target: "date", dateFormat: "MM/DD/YYYY" }], filters: { reportYear: 2026 } };
  const cells = [1, 2, 3, 4].map((row) => ({ row, column: 1, geometry: { x: 0.1, y: row / 10, width: 0.1, height: 0.03 } }));
  const resolved = resolveStructuredBinding(records, binding, cells);
  assert.deepEqual(resolved.values.map((value) => value.value), ["01/01/2026", "09/14/2026", "12/31/2026"]);
  assert.equal(resolved.requiresReview, false);
});
