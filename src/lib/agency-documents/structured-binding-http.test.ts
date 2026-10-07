import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStructuredBindingInput } from "./structured-binding-http";
const body = { sectionKey: "dates", sourceType: "qualification_history", fillMode: "sequential_cells", sortOrder: "date_desc", maxCells: 2, overflowBehavior: "require_review", columnMappings: [{ target: "date", dateFormat: "MM/DD/YYYY" }], formatting: { fontSize: 9 }, targetCells: [{ page: 2, order: 1, row: 1, column: 1, geometry: { x: .1, y: .2, width: .3, height: .04 } }] };
test("normalizes only the supported structured binding request fields", () => { const result = normalizeStructuredBindingInput({ ...body, department_id: "not-used" }); assert.equal(result.ordering, "date_desc"); assert.equal(result.targetCells[0]?.page, 2); });
test("invalid request configuration is rejected", () => assert.throws(() => normalizeStructuredBindingInput({ ...body, sourceType: "other" })));
