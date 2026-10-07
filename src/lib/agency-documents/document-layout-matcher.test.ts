import assert from "node:assert/strict";
import test from "node:test";
import { combineSemanticFindingsWithLayoutDiagnostics } from "./document-layout-matcher";
import type { DocumentLayout, LayoutNode } from "./document-layout-provider";

const node = (id: string, page: number, kind: LayoutNode["kind"], text: string, x: number, y: number, width: number, height: number, row?: number): LayoutNode => ({ id, page, kind, text, geometry: { x, y, width, height }, confidence: .9, row, links: [] });
const finding = (label: string, page = 1, kind: "scalar" | "structured" = "scalar") => ({ kind, page, label, geometry: { x: .8, y: .8, width: .1, height: .1 }, confidence: .9 } as const);
const layout = (nodes: LayoutNode[]): DocumentLayout => ({ provider: "textract", version: "test", nodes });

test("chooses the smallest adjacent same-row value region and rejects an oversized alternative", () => {
  const result = combineSemanticFindingsWithLayoutDiagnostics([finding("Date of Report")], layout([
    node("label", 1, "line", "Date of Report", .1, .2, .2, .025),
    node("large", 1, "cell", "", .42, .19, .35, .09),
    node("artifact", 1, "value", "", .31, .2, .001, .001),
    node("small", 1, "cell", "", .32, .2, .18, .025),
  ]));
  assert.equal(result.findings[0]?.geometry.x, .32);
  assert.equal(result.diagnostics[0]?.chosenTextractCandidate, "small");
  assert.equal(result.diagnostics[0]?.geometrySource, "TEXTRACT_CELL");
});

test("prevents unrelated labels from reusing an owned value region", () => {
  const result = combineSemanticFindingsWithLayoutDiagnostics([finding("Date of Report"), finding("Chief of Police")], layout([
    node("date", 1, "line", "Date of Report", .1, .2, .2, .025), node("chief", 1, "line", "Chief of Police", .1, .25, .2, .025),
    node("shared", 1, "cell", "", .32, .2, .2, .025),
  ]));
  assert.equal(result.diagnostics[0]?.geometrySource, "TEXTRACT_CELL");
  assert.equal(result.diagnostics[1]?.geometrySource, "REVIEW");
  assert.match(result.diagnostics[1]?.matchingReasons.join(" ") ?? "", /owned/);
});

test("derives a bounded subsection instead of returning its enclosing table", () => {
  const result = combineSemanticFindingsWithLayoutDiagnostics([finding("All Other Firearms Instructors", 1, "structured")], layout([
    node("table", 1, "table", "", .1, .1, .7, .7), node("heading", 1, "line", "All Other Firearms Instructors", .12, .5, .24, .03),
    node("c1", 1, "cell", "", .1, .5, .35, .05, 8), node("c2", 1, "cell", "", .45, .5, .35, .05, 8), node("c3", 1, "cell", "", .1, .55, .35, .05, 9), node("c4", 1, "cell", "", .45, .55, .35, .05, 9),
  ]));
  assert.equal(result.findings[0]?.geometry.x, .1);
  assert.equal(result.findings[0]?.geometry.y, .5);
  assert.ok(Math.abs((result.findings[0]?.geometry.width ?? 0) - .7) < 1e-9);
  assert.ok(Math.abs((result.findings[0]?.geometry.height ?? 0) - .1) < 1e-9);
  assert.equal(result.diagnostics[0]?.geometrySource, "TEXTRACT_TABLE");
  assert.deepEqual(result.findings[0]?.targetCells?.map(cell => [cell.row, cell.column, cell.order]), [[8, 1, 1], [8, 2, 2], [9, 1, 3], [9, 2, 4]]);
});

test("splits one Textract table into A/B/C Dates Fired subsections", () => {
  const nodes = [node("table", 2, "table", "", .2, .1, .6, .75)];
  for (const [section, y] of [["A", .2], ["B", .45], ["C", .7]] as const) {
    nodes.push(node(`section-${section}`, 2, "line", `${section}. Qualification`, .1, y - .06, .25, .025));
    nodes.push(node(`dates-${section}`, 2, "line", "Dates Fired", .12, y, .16, .025));
    nodes.push(node(`left-${section}`, 2, "cell", "", .2, y + .04, .3, .1), node(`right-${section}`, 2, "cell", "", .5, y + .04, .3, .1));
  }
  const result = combineSemanticFindingsWithLayoutDiagnostics([finding("Dates Fired - Section A", 2, "structured"), finding("Dates Fired - Section B", 2, "structured"), finding("Dates Fired - Section C", 2, "structured")], layout(nodes));
  assert.deepEqual(result.findings.map(value => Number(value.geometry.y.toFixed(2))), [.24, .49, .74]);
  assert.deepEqual(result.diagnostics.map(value => value.geometrySource), ["TEXTRACT_TABLE", "TEXTRACT_TABLE", "TEXTRACT_TABLE"]);
});

test("uses the nearest following ruled grid without crossing section boundaries", () => {
  const page = layout([node("a", 2, "line", "A. Qualification", .1, .1, .2, .02), node("dates-a", 2, "line", "Dates Fired", .15, .18, .16, .02), node("b", 2, "line", "B. Qualification", .1, .45, .2, .02)]);
  const grids = [{ id: "a-grid", page: 2, geometry: { x: .3, y: .23, width: .4, height: .12 }, horizontalLines: 5, verticalLines: 3, rows: 4, columns: 2, confidence: .9 }, { id: "b-grid", page: 2, geometry: { x: .3, y: .52, width: .4, height: .12 }, horizontalLines: 5, verticalLines: 3, rows: 4, columns: 2, confidence: .9 }];
  const result = combineSemanticFindingsWithLayoutDiagnostics([finding("Dates Fired - Section A", 2, "structured")], page, grids);
  assert.deepEqual(result.findings[0]?.geometry, grids[0]?.geometry);
  assert.equal(result.diagnostics[0]?.geometrySource, "GRID_DETECTOR");
  assert.equal(result.diagnostics[0]?.matchedSection, "A");
  assert.equal(result.findings[0]?.targetCells?.length, 8);
  assert.deepEqual(result.findings[0]?.targetCells?.map(cell => [cell.row, cell.column, cell.order]), [[1, 1, 1], [1, 2, 2], [2, 1, 3], [2, 2, 4], [3, 1, 5], [3, 2, 6], [4, 1, 7], [4, 2, 8]]);
});

test("keeps unmatched semantic findings review-only and preserves semantic guardrails", () => {
  const result = combineSemanticFindingsWithLayoutDiagnostics([{ ...finding("Chief of Police"), semanticKey: "person.full_name" }, finding("Course Type - Section A", 2)], layout([]));
  assert.equal(result.findings[0]?.semanticKey, undefined);
  assert.deepEqual(result.findings[1]?.geometry, { x: .01, y: .01, width: .02, height: .02 });
  assert.deepEqual(result.diagnostics.map(value => value.geometrySource), ["REVIEW", "REVIEW"]);
});
