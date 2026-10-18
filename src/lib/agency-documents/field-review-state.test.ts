import assert from "node:assert/strict";
import test from "node:test";
import { applyMappingChoice, orderedForReview, reviewState, reviewSummary, type ReviewField } from "./field-review-state";
import { publishBlockers } from "./proposal-review";

const g = (y: number) => ({ x: 0.1, y, width: 0.2, height: 0.03 });
const fields: ReviewField[] = [
  { id: "a", page_number: 1, field_type: "tracepoint_data", canonical_key: "person.full_name", label: "Officer Name", geometry: g(0.1), formatting: { matchStatus: "confirmed" } },
  { id: "b", page_number: 1, field_type: "tracepoint_data", canonical_key: "firearm.model", label: "Model", geometry: g(0.3), formatting: { matchStatus: "suggested" } },
  { id: "c", page_number: 2, field_type: "manual", label: "Case Number", geometry: g(0.2), formatting: { matchStatus: "unmatched" } },
];

test("flagged fields are listed first and block publishing until a person decides", () => {
  assert.deepEqual(orderedForReview(fields).map((field) => field.id), ["b", "c", "a"]);
  assert.equal(reviewSummary(fields).readyToPublish, false);
  assert.equal(publishBlockers(fields.map((field) => ({ ...field, canonical_key: field.canonical_key ?? null, label: field.label ?? null, static_text: null }))).length, 1);
});

test("confirming, re-mapping, switching to manual or a fixed value all confirm the field", () => {
  const confirmed = applyMappingChoice(fields[1]!, { kind: "confirm" })!;
  assert.equal(reviewState(confirmed), "tracepoint");
  const remapped = applyMappingChoice(fields[1]!, { kind: "tracepoint", key: "firearm.manufacturer" })!;
  assert.equal(remapped.canonical_key, "firearm.manufacturer");
  assert.equal(remapped.formatting?.matchStatus, "confirmed");
  const manual = applyMappingChoice(fields[1]!, { kind: "manual", required: true })!;
  assert.equal(manual.field_type, "manual");
  assert.equal(manual.canonical_key, null);
  assert.equal(manual.is_required, true);
  const fixed = applyMappingChoice(fields[2]!, { kind: "fixed", value: " NJ0000000 " })!;
  assert.equal(fixed.static_text, "NJ0000000");
  const next = [fields[0]!, confirmed, fixed];
  assert.equal(reviewSummary(next).readyToPublish, true);
});

test("invalid choices are refused rather than saved", () => {
  assert.equal(applyMappingChoice(fields[0]!, { kind: "tracepoint", key: "profiles.secret" }), null);
  assert.equal(applyMappingChoice(fields[2]!, { kind: "fixed", value: "   " }), null);
  assert.equal(applyMappingChoice({ ...fields[0]!, canonical_key: "removed.key" }, { kind: "confirm" }), null);
});

test("native form-field and Word locators survive a mapping change", () => {
  const native = { ...fields[1]!, formatting: { matchStatus: "suggested", acroFieldName: "Model", widgets: [{ page: 1, geometry: g(0.3) }] } };
  const changed = applyMappingChoice(native, { kind: "manual", required: false })!;
  assert.equal(changed.formatting?.acroFieldName, "Model");
  assert.ok(Array.isArray(changed.formatting?.widgets));
});
