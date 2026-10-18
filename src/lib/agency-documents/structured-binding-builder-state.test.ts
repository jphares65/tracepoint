import assert from "node:assert/strict";
import test from "node:test";
import { bindingStatus, orderedTargetCells, structuredSectionKey } from "./structured-binding-builder-state";
const cells = [{ page: 2, order: 9, row: 2, column: 1, geometry: { x: .1, y: .4, width: .1, height: .03 } }, { page: 2, order: 8, row: 1, column: 2, geometry: { x: .3, y: .2, width: .1, height: .03 } }, { page: 2, order: 7, row: 1, column: 1, geometry: { x: .1, y: .2, width: .1, height: .03 } }];
test("structured section state distinguishes unbound, bound, and missing-cell review", () => { assert.equal(bindingStatus(undefined, cells), "Not bound"); assert.equal(bindingStatus({ sourceType: "qualification_history", targetCells: cells }, cells), "Bound to Qualification History"); assert.equal(bindingStatus(undefined, []), "Review required"); assert.equal(structuredSectionKey("proposal-1"), "structured-section-proposal-1"); });
test("target cells use top-to-bottom, left-to-right numbering", () => assert.deepEqual(orderedTargetCells(cells).map((cell) => [cell.row, cell.column, cell.order]), [[1, 1, 1], [1, 2, 2], [2, 1, 3]]));
