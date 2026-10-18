import assert from "node:assert/strict";
import test from "node:test";
import {
  StructuredBindingDuplicateError, StructuredBindingNotFoundError, StructuredBindingRepository,
  type CreateStructuredBindingInput, type StructuredBindingInsertRow, type StructuredBindingProviderResult,
  type StructuredBindingRow, type StructuredBindingSupabaseClient, type StructuredBindingUpdateRow,
  qualificationRecordFromDocumentRow, structuredBindingFromRow, validateStructuredBinding,
} from "./structured-binding-repository";

const input: CreateStructuredBindingInput = {
  templateId: "template-1", templateVersionId: "version-1", actorUserId: "actor-1", sectionKey: "dates-a",
  sourceType: "qualification_history", fillMode: "sequential_cells", ordering: "date_asc", maxRows: 4,
  overflowBehavior: "require_review", columnMappings: [{ target: "date", dateFormat: "MM/DD/YYYY" }], formatting: { fontSize: 10 },
  targetCells: [{ page: 2, order: 2, row: 1, column: 2, geometry: { x: .4, y: .3, width: .1, height: .03 } }, { page: 2, order: 1, row: 1, column: 1, geometry: { x: .3, y: .3, width: .1, height: .03 } }],
};
function row(overrides: Partial<StructuredBindingRow> = {}): StructuredBindingRow { return { id: "binding-1", department_id: "department-1", template_id: "template-1", template_version_id: "version-1", section_key: "dates-a", source_type: "qualification_history", fill_mode: "sequential_cells", ordering: "date_asc", max_rows: 4, overflow_behavior: "require_review", filters: null, column_mappings: [{ target: "date", dateFormat: "MM/DD/YYYY" }], formatting: { fontSize: 10 }, target_cells: input.targetCells, created_by_user_id: "actor-1", updated_by_user_id: "actor-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides }; }
type Call = { operation: string; payload?: StructuredBindingInsertRow | StructuredBindingUpdateRow; filters: [string, string][]; select?: string };
function fakeClient(results: StructuredBindingProviderResult<StructuredBindingRow | StructuredBindingRow[]>[], calls: Call[]): StructuredBindingSupabaseClient {
  const nextRow = () => results.shift() as StructuredBindingProviderResult<StructuredBindingRow> ?? { data: row(), error: null };
  const nextRows = () => results.shift() as StructuredBindingProviderResult<StructuredBindingRow[]> ?? { data: [row()], error: null };
  return { from() {
    const filters: [string, string][] = [];
    const read = { eq(column: string, value: string) { filters.push([column, value]); return read; }, order(column: string) { calls.push({ operation: "list", filters, select: column }); return Promise.resolve(nextRows()); }, maybeSingle() { calls.push({ operation: "get", filters }); return Promise.resolve(nextRow()); } };
    const mutation = (operation: "update" | "delete", payload?: StructuredBindingUpdateRow) => { const query = { eq(column: string, value: string) { filters.push([column, value]); return query; }, select(columns: string) { calls.push({ operation, payload, filters, select: columns }); return { single: () => Promise.resolve(nextRow()) }; } }; return query; };
    return { select: () => read, insert: (payload: StructuredBindingInsertRow) => ({ select: (columns: string) => { calls.push({ operation: "insert", payload, filters, select: columns }); return { single: () => Promise.resolve(nextRow()) }; } }), update: (payload: StructuredBindingUpdateRow) => mutation("update", payload), delete: () => mutation("delete") };
  } };
}

test("validation rejects unsupported configuration before mutation", async () => { assert.throws(() => validateStructuredBinding({ ...input, targetCells: [{ ...input.targetCells[0], order: 0 }] })); const calls: Call[] = []; await assert.rejects(() => new StructuredBindingRepository(fakeClient([], calls), "department-1").create({ ...input, maxRows: 0 })); assert.equal(calls.length, 0); });
test("create maps a row and classifies duplicate sections", async () => { const calls: Call[] = []; const created = await new StructuredBindingRepository(fakeClient([{ data: row(), error: null }], calls), "department-1").create(input); assert.equal(created.templateVersionId, "version-1"); assert.deepEqual(created.targetCells.map((cell) => cell.order), [2, 1]); assert.deepEqual(calls[0]?.payload?.target_cells, input.targetCells); await assert.rejects(() => new StructuredBindingRepository(fakeClient([{ data: null, error: { code: "23505", message: "duplicate" } }], []), "department-1").create(input), StructuredBindingDuplicateError); });
test("read methods map rows and constrain department/version", async () => { const calls: Call[] = []; const repository = new StructuredBindingRepository(fakeClient([{ data: [row()], error: null }, { data: row(), error: null }], calls), "department-1"); assert.equal((await repository.listByTemplateVersion("version-1"))[0]?.id, "binding-1"); assert.equal((await repository.getBySectionKey("version-1", "dates-a"))?.sectionKey, "dates-a"); assert.deepEqual(calls[0]?.filters, [["department_id", "department-1"], ["template_version_id", "version-1"]]); assert.deepEqual(calls[1]?.filters, [["department_id", "department-1"], ["template_version_id", "version-1"], ["section_key", "dates-a"]]); assert.equal(structuredBindingFromRow(row()).formatting.fontSize, 10); });
test("update and delete confirm rows and classify no-row results", async () => { const calls: Call[] = []; const repository = new StructuredBindingRepository(fakeClient([{ data: row({ section_key: "dates-b" }), error: null }, { data: row(), error: null }], calls), "department-1"); assert.equal((await repository.update("binding-1", "version-1", { ...input, sectionKey: "dates-b" })).sectionKey, "dates-b"); assert.equal(await repository.delete("binding-1", "version-1"), "binding-1"); for (const call of calls) assert.deepEqual(call.filters, [["department_id", "department-1"], ["template_version_id", "version-1"], ["id", "binding-1"]]); const missing = { data: null, error: { code: "PGRST116", message: "no rows" } }; await assert.rejects(() => new StructuredBindingRepository(fakeClient([missing], []), "department-1").update("binding-1", "version-1", input), StructuredBindingNotFoundError); await assert.rejects(() => new StructuredBindingRepository(fakeClient([missing], []), "department-1").delete("binding-1", "version-1"), StructuredBindingNotFoundError); });
test("qualification rows map to the stable document DTO", () => assert.deepEqual(qualificationRecordFromDocumentRow({ id: "q", qualification_date: "2026-01-02", historical_course_name: "HQC", passed: true, score: 95, instructor_name: "I", historical_qualification_type: "handgun" }), { id: "q", date: "2026-01-02", courseName: "HQC", result: "Pass", score: 95, instructor: "I", firearmType: "handgun" }));

test("a binding whose cells cannot hold whole records is refused when it is saved", () => {
  assert.throws(() => validateStructuredBinding({ ...input, fillMode: "rows", columnMappings: [{ target: "date" }, { target: "score" }], targetCells: [input.targetCells[0]!] }), /whole number/);
  assert.throws(() => validateStructuredBinding({ ...input, columnMappings: [] }), /at least one mapped column/);
  assert.doesNotThrow(() => validateStructuredBinding({ ...input, fillMode: "rows", columnMappings: [{ target: "date" }, { target: "score" }] }));
});
