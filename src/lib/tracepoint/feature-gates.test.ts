import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasEnabledFeatures, MODULE_FEATURES } from "./feature-gates.ts";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("ADM-23: a module needs every feature it depends on; Analytics needs Range & Training too", () => {
  assert.equal(hasEnabledFeatures(["analytics"], MODULE_FEATURES.analytics), false);
  assert.equal(hasEnabledFeatures(["analytics", "range_training"], MODULE_FEATURES.analytics), true);
  assert.equal(hasEnabledFeatures([], undefined), true);
  assert.equal(hasEnabledFeatures(new Set(["firearms"]), MODULE_FEATURES.firearms), true);
});

test("ADM-23: navigation applies the shared rule, with no platform-administrator bypass", () => {
  const shell = source("../../app/components/TracePointShell.tsx");
  assert.doesNotMatch(shell, /featureCode/);
  assert.doesNotMatch(shell, /!isSuperAdmin &&/);
  assert.match(shell, /href: "\/analytics",\s*features: MODULE_FEATURES\.analytics,/);
  assert.match(shell, /if \(!hasEnabledFeatures\(enabledFeatures, child\.features\)\) \{\s*return false;/);
  assert.match(shell, /!isNavigationGroup\(item\) &&\s*!hasEnabledFeatures\(enabledFeatures, item\.features\)/);
  const hook = source("./useTracePointAccess.ts");
  assert.match(hook, /\(featureCode: string\) => hasEnabledFeatures\(featureSet, \[featureCode\]\)/);
  assert.doesNotMatch(hook, /access\.isSuperAdmin \|\| featureSet\.has/);
});

test("ADM-23: layouts and the API helper apply the same rule as navigation", () => {
  const layouts: Array<[string, keyof typeof MODULE_FEATURES]> = [
    ["analytics", "analytics"], ["command-dashboard", "commandDashboard"], ["off-duty-firearms", "offDuty"],
    ["qualifications", "qualifications"], ["range-days", "rangeTraining"], ["training-alerts", "rangeTraining"],
  ];
  for (const [directory, key] of layouts) {
    const layout = source(`../../app/${directory}/layout.tsx`);
    assert.match(layout, new RegExp(`if \\(!hasEnabledFeatures\\(resolved\\.context\\.enabledFeatures, MODULE_FEATURES\\.${key}\\)\\) \\{\\s*redirect\\("/"\\);`), directory);
  }
  assert.match(source("./server-access.ts"), /return hasEnabledFeatures\(context\.enabledFeatures, \[featureCode\]\);/);
});
