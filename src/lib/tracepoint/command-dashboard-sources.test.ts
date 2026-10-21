import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cardLoadFailed,
  dashboardLoadFailures,
  readDashboardSource,
  type CommandDashboardSource,
} from "./command-dashboard-sources.ts";

const page = readFileSync(new URL("../../app/command-dashboard/page.tsx", import.meta.url), "utf8");
const response = (ok: boolean, body: unknown) => ({ ok, json: async () => {
  if (body instanceof Error) throw body;
  return body;
} });

test("ADM-10: a non-OK or unreadable response is recorded as a failed source, not read as empty data", async () => {
  const failed = new Set<CommandDashboardSource>();
  assert.equal(await readDashboardSource("certifications", response(false, { error: "denied" }), failed), null);
  assert.equal(await readDashboardSource("equipment", response(true, new Error("bad json")), failed), null);
  assert.deepEqual(await readDashboardSource("firearms", response(true, { firearms: [] }), failed), { firearms: [] });
  assert.deepEqual([...failed].sort(), ["certifications", "equipment"]);
});

test("ADM-10: a card is unavailable when any source it is computed from failed", () => {
  const failed = new Set<CommandDashboardSource>(["certifications", "workspace"]);
  assert.equal(cardLoadFailed("certification_readiness", failed), true);
  assert.equal(cardLoadFailed("firearm_reliability", failed), true);
  assert.equal(cardLoadFailed("range_readiness", failed), true);
  assert.equal(cardLoadFailed("equipment_readiness", failed), false);
  assert.equal(cardLoadFailed("qualification_readiness", failed), false);
  assert.equal(cardLoadFailed("agency_training", failed), false);
});

test("ADM-10: a source refused because its module is off for the agency is not reported as a load failure", () => {
  const failed = new Set<CommandDashboardSource>(["performance", "workspace", "firearms", "certifications"]);
  assert.deepEqual([...dashboardLoadFailures(failed, new Set(["qualifications", "firearms"]))].sort(), ["certifications", "firearms", "workspace"]);
  assert.deepEqual([...dashboardLoadFailures(failed, new Set(["range_training"]))].sort(), ["certifications", "performance", "workspace"]);
});

test("ADM-10: the dashboard reads every source through readDashboardSource and shows failures", () => {
  for (const source of ["personnel", "firearms", "workspace", "rules", "certifications", "performance", "equipment"]) {
    assert.match(page, new RegExp(`"${source}"`), source);
  }
  assert.equal(page.match(/await readDashboardSource</g)?.length, 7);
  assert.doesNotMatch(page, /Response\.ok\s*\?/);
  assert.match(page, /\(\) => dashboardLoadFailures\(failedSources, featureSet\)/);
  assert.match(page, /if \(!cardLoadFailed\(key, loadFailures\)\) return;\s*dashboardCards\[key\] = \(\s*<PulseCard[\s\S]*?label="Data unavailable"/);
  assert.match(page, /sourceUnavailable\("certifications"\)\s*\? "Data unavailable"\s*: certificationReadiness\.summary\.totalRequiredChecks === 0/);
  assert.match(page, /sourceUnavailable\("equipment"\)\s*\? "Data unavailable"\s*: equipmentReadiness\.summary\.totalRequiredChecks === 0/);
  assert.match(page, /Some command dashboard data could not be loaded:/);
});
