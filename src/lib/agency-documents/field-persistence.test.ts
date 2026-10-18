import assert from "node:assert/strict";
import test from "node:test";
import { fieldLocator, planFieldSave, reuseIdsByLocator, structuredPublishBlockers } from "./field-persistence";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", FOREIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let counter = 0;
const fresh = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

test("saving keeps existing field ids, creates ids only for new fields, and removes deleted ones", () => {
  const plan = planFieldSave([A, B], [{ id: A, label: "Officer" }, { id: "local-temp-id", label: "New" }], fresh);
  assert.equal(plan.rows[0]!.id, A);
  assert.match(plan.rows[1]!.id, /^00000000-/);
  assert.deepEqual(plan.staleIds, [B]);
  assert.deepEqual(plan.ids.map((entry) => entry.created), [false, true]);
});

test("a client cannot claim an id that does not belong to this template version", () => {
  const plan = planFieldSave([A], [{ id: FOREIGN, label: "Injected" }, { id: A }, { id: A }], fresh);
  assert.notEqual(plan.rows[0]!.id, FOREIGN);
  assert.equal(plan.rows[1]!.id, A);
  assert.notEqual(plan.rows[2]!.id, A, "a duplicated id in one request becomes a new field");
  assert.deepEqual(plan.staleIds, []);
});

test("setting up again from the same form keeps ids for fields at the same place in the form", () => {
  const existing = [
    { id: A, formatting: { acroFieldName: "OfficerName" } },
    { id: B, formatting: { docxTarget: { part: "word/document.xml", kind: "token", ordinal: 0, label: "Officer Name" } } },
    { id: FOREIGN, formatting: { acroFieldName: "Removed" } },
  ];
  const planned = [
    { id: "n1", formatting: { acroFieldName: "OfficerName" } },
    { id: "n2", formatting: { docxTarget: { part: "word/document.xml", kind: "token", ordinal: 0, label: "Officer Name" } } },
    { id: "n3", formatting: { acroFieldName: "BadgeNo" } },
  ];
  const result = reuseIdsByLocator(planned, existing);
  assert.deepEqual(result.rows.map((row) => row.id), [A, B, "n3"]);
  assert.deepEqual(result.staleIds, [FOREIGN]);
  assert.equal(fieldLocator({ formatting: {} }), null);
});

test("unbound repeating sections block publishing until bound or dismissed", () => {
  const proposals = [
    { id: "p1", status: "proposed", proposal: { kind: "structured_section", detectedLabel: "Dates Fired" } },
    { id: "p2", status: "proposed", proposal: { kind: "structured_section", detectedLabel: "Roster" } },
    { id: "p3", status: "rejected", proposal: { kind: "structured_section", detectedLabel: "Dismissed" } },
    { id: "p4", status: "proposed", proposal: { kind: "scalar_field", detectedLabel: "Officer Signature" } },
  ];
  const blockers = structuredPublishBlockers(proposals, ["structured-section-p1"]);
  assert.deepEqual(blockers.map((blocker) => blocker.message), ["Roster: bind it to TracePoint data or leave it blank."]);
});
