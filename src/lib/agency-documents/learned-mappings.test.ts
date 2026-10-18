import assert from "node:assert/strict";
import test from "node:test";
import { learnedMappingsFromFields } from "./learned-mappings";
import { analyzeTemplatePdf } from "./template-analyzer";
import { buildAcroFormPdf } from "./__fixtures__/synthetic-forms";

const byPerson = { matchStatus: "confirmed", confirmedByPerson: true };

test("only consistent decisions made by a person are learned — never automatic setup", () => {
  const learned = learnedMappingsFromFields([
    { field_type: "tracepoint_data", canonical_key: "person.badge_number", formatting: { normalizedLabel: "employee number", ...byPerson }, template_name: "Range Card" },
    { field_type: "tracepoint_data", canonical_key: "person.badge_number", formatting: { normalizedLabel: "employee number", ...byPerson } },
    { field_type: "manual", canonical_key: null, formatting: { normalizedLabel: "case number", confirmedByPerson: true } },
    { field_type: "tracepoint_data", canonical_key: "person.full_name", formatting: { normalizedLabel: "member", ...byPerson } },
    { field_type: "tracepoint_data", canonical_key: "preparer.full_name", formatting: { normalizedLabel: "member", ...byPerson } },
    { field_type: "tracepoint_data", canonical_key: "person.rank", formatting: { normalizedLabel: "grade", matchStatus: "suggested" } },
    { field_type: "tracepoint_data", canonical_key: "person.rank", formatting: { normalizedLabel: "auto only", matchStatus: "confirmed" } },
    { field_type: "manual", canonical_key: null, formatting: { normalizedLabel: "never reviewed" } },
    { field_type: "tracepoint_data", canonical_key: "profiles.secret", formatting: { normalizedLabel: "secret", confirmedByPerson: true } },
  ]);
  assert.deepEqual(learned.sort((a, b) => a.normalizedLabel.localeCompare(b.normalizedLabel)), [
    { normalizedLabel: "case number", key: null, templateName: undefined },
    { normalizedLabel: "employee number", key: "person.badge_number", templateName: "Range Card" },
  ]);
});

test("a second form reuses what the agency confirmed on the first, so it does not have to be mapped again", async () => {
  const learned = learnedMappingsFromFields([{ field_type: "tracepoint_data", canonical_key: "person.badge_number", formatting: { normalizedLabel: "employee number", ...byPerson }, template_name: "Range Card" }]);
  const form = await buildAcroFormPdf([{ fields: [{ name: "Employee No", x: 50, y: 700, width: 100, height: 18 }] }]);
  const without = (await analyzeTemplatePdf(form)).proposals[0]!;
  assert.notEqual(without.matchStatus, "exact");
  const withLearned = (await analyzeTemplatePdf(form, { learned })).proposals[0]!;
  assert.equal(withLearned.matchStatus, "exact");
  assert.equal(withLearned.suggestedSemanticKey, "person.badge_number");
  assert.match(withLearned.rationale ?? "", /Range Card/);
});
