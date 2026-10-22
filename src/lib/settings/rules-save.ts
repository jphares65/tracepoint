// Settings > Rules Engine save scopes (SV-29, E-04).
//
// The page's own `rules` draft holds the department_rules columns edited on
// the Armory and Range & Qualifications sub-tabs. Each of those sub-tabs has
// its own Save, and each Save writes only the columns that sub-tab shows. The
// other department_rules columns belong to the panels that edit them and save
// through their own routes (Off-Duty Firearms: off_duty_renewal_days and the
// off-duty requirements; Range panel: require_rifle_familiarization). Writing
// the whole draft from the page sent stale copies of those columns and
// overwrote what the panels had just saved.
export const RULES_SAVE_SCOPES = {
  armory: {
    label: "Armory Rules",
    saved: "Armory rules saved.",
    fields: [
      "inspection_interval_days",
      "battery_check_interval_days",
      "allow_personally_owned_rifles",
      "require_personal_rifle_armorer_inspection",
      "require_personal_rifle_chief_approval",
      "require_personal_rifle_qualification",
      "require_personal_rifle_annual_reinspection",
      "require_personal_rifle_spec_acknowledgment",
    ],
  },
  range: {
    label: "Qualification Cycles",
    saved: "Qualification cycles and validity saved.",
    fields: [
      "spring_cycle_start",
      "spring_cycle_end",
      "fall_cycle_start",
      "fall_cycle_end",
      "qualification_valid_days",
      "qualification_due_soon_days",
    ],
  },
} as const;

export type RulesSaveScope = keyof typeof RULES_SAVE_SCOPES;

export function isRulesSaveScope(value: string): value is RulesSaveScope {
  return Object.prototype.hasOwnProperty.call(RULES_SAVE_SCOPES, value);
}

/** The department_rules columns one sub-tab's Save writes, and nothing else. */
export function rulesScopePayload<T extends Record<string, unknown>>(scope: RulesSaveScope, rules: T) {
  return Object.fromEntries(RULES_SAVE_SCOPES[scope].fields.map((field) => [field, rules[field]])) as Partial<T>;
}

/** Whether the draft differs from the last saved rules within one scope. */
export function rulesScopeDirty<T extends Record<string, unknown>>(scope: RulesSaveScope, rules: T, saved: T) {
  return RULES_SAVE_SCOPES[scope].fields.some((field) => rules[field] !== saved[field]);
}

/** The draft with one scope's unsaved edits put back to the saved values. */
export function revertRulesScope<T extends Record<string, unknown>>(scope: RulesSaveScope, rules: T, saved: T): T {
  return { ...rules, ...rulesScopePayload(scope, saved) };
}

// The header Save saves the page-level form of the open tab. The Rules Engine
// tab has no single form: each sub-tab saves its own rules beside its fields.
const HEADER_SAVE_TABS = new Set(["agency", "branding", "audit"]);

export function headerSaveApplies(tab: string) {
  return HEADER_SAVE_TABS.has(tab);
}
