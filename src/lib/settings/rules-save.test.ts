import assert from "node:assert/strict";
import test from "node:test";

import { headerSaveApplies, revertRulesScope, RULES_SAVE_SCOPES, rulesScopeDirty, rulesScopePayload } from "./rules-save.ts";

const saved = {
  spring_cycle_start: "04-01", spring_cycle_end: "06-30", fall_cycle_start: "09-01", fall_cycle_end: "11-30",
  require_rifle_familiarization: true, qualification_valid_days: 365, qualification_due_soon_days: 30,
  inspection_interval_days: 180, battery_check_interval_days: 180, off_duty_renewal_days: 365,
  allow_personally_owned_rifles: false, require_personal_rifle_armorer_inspection: true, require_personal_rifle_chief_approval: true,
  require_personal_rifle_qualification: true, require_personal_rifle_annual_reinspection: true, require_personal_rifle_spec_acknowledgment: true,
};

test("E-04: no Rules Save writes columns owned by another panel", () => {
  for (const scope of Object.keys(RULES_SAVE_SCOPES) as Array<keyof typeof RULES_SAVE_SCOPES>) {
    const payload = rulesScopePayload(scope, saved);
    assert.equal("off_duty_renewal_days" in payload, false, scope);
    assert.equal("require_rifle_familiarization" in payload, false, scope);
  }
  assert.deepEqual(Object.keys(rulesScopePayload("range", saved)), [...RULES_SAVE_SCOPES.range.fields]);
  assert.deepEqual(Object.keys(rulesScopePayload("armory", saved)), [...RULES_SAVE_SCOPES.armory.fields]);
  const shared = RULES_SAVE_SCOPES.armory.fields.filter((field) => (RULES_SAVE_SCOPES.range.fields as readonly string[]).includes(field));
  assert.deepEqual(shared, [], "each column has one Save");
});

test("E-06: unsaved changes are tracked per sub-tab and can be put back", () => {
  const draft = { ...saved, battery_check_interval_days: 90 };
  assert.equal(rulesScopeDirty("armory", draft, saved), true);
  assert.equal(rulesScopeDirty("range", draft, saved), false);
  assert.deepEqual(revertRulesScope("armory", draft, saved), saved);
});

test("E-04: the header Save is not offered on Rules Engine, whose sub-tabs save themselves", () => {
  assert.equal(headerSaveApplies("rules"), false);
  for (const tab of ["agency", "branding", "audit"]) assert.equal(headerSaveApplies(tab), true, tab);
  for (const tab of ["users", "organization", "views", "importExport", "notifications"]) assert.equal(headerSaveApplies(tab), false, tab);
});
