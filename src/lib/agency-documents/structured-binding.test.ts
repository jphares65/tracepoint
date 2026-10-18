import assert from "node:assert/strict";
import test from "node:test";
import { formatQualificationDate, orderedStructuredCells, resolveStructuredBinding, type StructuredBinding } from "./structured-binding";
const binding: StructuredBinding = { sourceType: "qualification_history", fillMode: "sequential_cells", ordering: "date_asc", maxRows: 3, overflowBehavior: "require_review", columnMappings: [{ target: "date", dateFormat: "MM/DD/YYYY" }], filters: { reportYear: 2026 } };
const cells = [{ row: 2, column: 1, geometry: { x: .5, y: .2, width: .1, height: .03 } }, { row: 1, column: 2, geometry: { x: .6, y: .1, width: .1, height: .03 } }, { row: 1, column: 1, geometry: { x: .5, y: .1, width: .1, height: .03 } }];
test("qualification bindings filter report year, sort deterministically, and fill stable cell order", () => { const result = resolveStructuredBinding([{ id: "b", date: "2026-03-02" }, { id: "a", date: "2026-01-02" }, { id: "old", date: "2025-01-01" }], binding, cells); assert.deepEqual(result.values.map(value => value.value), ["01/02/2026", "03/02/2026"]); assert.deepEqual(orderedStructuredCells(cells).map(cell => cell.row + ":" + cell.column), ["1:1", "1:2", "2:1"]); });
test("underflow leaves cells unfilled while overflow warns or errors explicitly", () => { const many = [{ id: "1", date: "2026-01-01" }, { id: "2", date: "2026-01-02" }, { id: "3", date: "2026-01-03" }, { id: "4", date: "2026-01-04" }]; const result = resolveStructuredBinding(many, binding, cells.slice(0, 2)); assert.equal(result.values.length, 2); assert.equal(result.requiresReview, true); assert.match(result.warnings[0]!, /exceeds/); assert.throws(() => resolveStructuredBinding(many, { ...binding, overflowBehavior: "error" }, cells.slice(0, 2))); });
test("date formatting is explicit and never locale dependent", () => { assert.equal(formatQualificationDate("2026-02-03", "MM/DD/YY"), "02/03/26"); assert.equal(formatQualificationDate("2026-02-03", "YYYY-MM-DD"), "2026-02-03"); });

test("each record takes a whole row of cells, and its values carry the page of the cell they go in", async () => {
  const { resolveDocumentStructuredBindings } = await import("./structured-document-resolution");
  // Two rows on page 1 and one on page 2, saved in no particular order.
  const cell = (page: number, row: number, column: number) => ({ page, order: page * 10 + row * 2 + column, row, column, geometry: { x: column * 0.2, y: row * 0.1, width: 0.15, height: 0.03 } });
  const targetCells = [cell(2, 1, 2), cell(1, 2, 1), cell(1, 1, 2), cell(2, 1, 1), cell(1, 1, 1), cell(1, 2, 2)];
  const records = [{ id: "a", date: "2026-01-02", score: 280 }, { id: "b", date: "2026-02-03", score: 290 }, { id: "c", date: "2026-03-04", score: 300 }];
  const resolved = resolveDocumentStructuredBindings([{ ...binding, id: "b1", sectionKey: "history", fillMode: "rows", maxRows: 3, filters: undefined, columnMappings: [{ target: "date", dateFormat: "MM/DD/YYYY" }, { target: "score" }], targetCells }], records);
  assert.deepEqual(resolved.fields.map((field) => `${field.pageNumber}:${field.value}@${field.geometry.x.toFixed(1)},${field.geometry.y.toFixed(1)}`), [
    "1:01/02/2026@0.2,0.1", "1:280@0.4,0.1",
    "1:02/03/2026@0.2,0.2", "1:290@0.4,0.2",
    "2:03/04/2026@0.2,0.1", "2:300@0.4,0.1",
  ]);
});

test("cells that cannot be split into whole records are refused rather than shifting later records", async () => {
  const { StructuredLayoutError } = await import("./structured-binding");
  const two = { ...binding, fillMode: "rows" as const, columnMappings: [{ target: "date" as const }, { target: "score" as const }] };
  const g = cells[0]!.geometry;
  // Three cells for two-column records.
  assert.throws(() => resolveStructuredBinding([{ id: "a", date: "2026-01-02" }], two, [{ row: 1, column: 1, geometry: g }, { row: 1, column: 2, geometry: g }, { row: 2, column: 1, geometry: g }]), StructuredLayoutError);
  // A row missing its second cell would pull the next row's first cell into this record.
  assert.throws(() => resolveStructuredBinding([{ id: "a", date: "2026-01-02" }], two, [{ row: 1, column: 1, geometry: g }, { row: 2, column: 1, geometry: g }, { row: 2, column: 2, geometry: g }, { row: 3, column: 1, geometry: g }]), StructuredLayoutError);
});

test("overflow always needs a decision, whatever the overflow setting", () => {
  const many = [{ id: "1", date: "2026-01-01" }, { id: "2", date: "2026-01-02" }, { id: "3", date: "2026-01-03" }];
  const result = resolveStructuredBinding(many, { ...binding, filters: undefined, overflowBehavior: "truncate_with_warning" }, cells.slice(0, 2));
  assert.equal(result.requiresReview, true);
  assert.match(result.warnings[0]!, /room for 2; 1 will not be printed/);
});
