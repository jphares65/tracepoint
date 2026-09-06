import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { effectiveDepartmentPermissions } from "./permission-authority.ts";
import {
  meetsPermissionRequirement,
  TRACEPOINT_PERMISSIONS,
  TRAINING_ALERTS_FEED_PERMISSIONS,
  TRAINING_ALERTS_MODULE_PERMISSIONS,
  TRAINING_ALERTS_WORKFLOW_PERMISSIONS,
} from "./permissions.ts";

const legacyPermissions = [
  "create_remediations",
  "manage_remediations",
  "resolve_remediations",
  "view_training_alerts",
  "manage_training_alerts",
  "view_command_training_alerts",
] as const;

test("failed qualification threshold uses consecutive qualifications everywhere in the control", async () => {
  const panel = await readFile(
    "src/app/settings/components/RangeQualificationRulesPanel.tsx",
    "utf8",
  );
  assert.match(panel, /FAILED_QUALIFICATION_THRESHOLD_UNIT = "qualifications"/);
  assert.match(panel, /label="Failed qualification threshold"[\s\S]*unit={FAILED_QUALIFICATION_THRESHOLD_UNIT}/);
  assert.match(panel, /Number of consecutive failed qualifications with the same firearm/);
  assert.match(panel, /A later passing qualification resets the count/);
  assert.match(panel, /aria-label={`\$\{label\} in \$\{unit\}`}/);
  assert.doesNotMatch(
    panel.match(/label="Failed qualification threshold"[\s\S]{0,600}/)?.[0] ?? "",
    />days</,
  );
});

test("obsolete Qualification Scoring notice is removed without removing real range scoring", async () => {
  const [settings, rangeDays] = await Promise.all([
    readFile("src/app/settings/page.tsx", "utf8"),
    readFile("src/app/range-days/page.tsx", "utf8"),
  ]);
  assert.doesNotMatch(settings, /Scoring moved to Range/);
  assert.doesNotMatch(settings, /title="Qualification Scoring"/);
  assert.match(rangeDays, /Qualification Scoring Components/);
  assert.match(rangeDays, /departmentStandardPassed/);
});

test("Qualifications, Training Alerts, and notification generation share canonical readiness", async () => {
  const [qualifications, performance, notifications] = await Promise.all([
    readFile("src/app/qualifications/page.tsx", "utf8"),
    readFile("src/app/api/pilot/performance-summary/route.ts", "utf8"),
    readFile("src/app/api/notifications/route.ts", "utf8"),
  ]);
  assert.match(qualifications, /evaluateCanonicalQualificationReadiness/);
  assert.match(performance, /evaluateCanonicalQualificationReadiness/);
  assert.match(performance, /repository\.getWorkspace\(departmentId\)/);
  assert.match(notifications, /evaluateCanonicalQualificationReadiness/);
  assert.doesNotMatch(performance, /function qualificationStatus/);
});

test("Training Alerts separates read-only feed access from management workflow access", () => {
  const readOnly = effectiveDepartmentPermissions([], ["view_analytics"]);
  const manager = effectiveDepartmentPermissions([], ["manage_training"]);
  const administrator = effectiveDepartmentPermissions(["administrator"], []);
  const can = (permissions: typeof readOnly, requirement: readonly (typeof TRACEPOINT_PERMISSIONS)[number][]) =>
    meetsPermissionRequirement(permissions, { anyOf: requirement });

  assert.equal(can(readOnly, TRAINING_ALERTS_MODULE_PERMISSIONS), true);
  assert.equal(can(readOnly, TRAINING_ALERTS_FEED_PERMISSIONS), true);
  assert.equal(can(readOnly, TRAINING_ALERTS_WORKFLOW_PERMISSIONS), false);
  assert.equal(can(manager, TRAINING_ALERTS_FEED_PERMISSIONS), true);
  assert.equal(can(manager, TRAINING_ALERTS_WORKFLOW_PERMISSIONS), true);
  assert.equal(can([], TRAINING_ALERTS_MODULE_PERMISSIONS), false);
  assert.equal(can(administrator, TRAINING_ALERTS_WORKFLOW_PERMISSIONS), true);
});

test("read-only UI does not load remediation data or render enabled mutation controls", async () => {
  const client = await readFile(
    "src/app/training-alerts/TrainingAlertsClient.tsx",
    "utf8",
  );
  assert.match(client, /canManage\s*\? fetch\("\/api\/pilot\/remediations"/);
  assert.match(client, /{canManage \? \([\s\S]*Create Remediation/);
  assert.match(client, /if \(!canManage\) return;/);
  assert.match(client, /role="alert"[\s\S]*Changes were not saved/);
  assert.doesNotMatch(client, /console\.warn\("Could not save remediation records/);
});

test("legacy permission retirement archives assignments and never translates grants", async () => {
  const migration = await readFile(
    "supabase/migrations/202609060001_retire_legacy_training_alert_permissions.sql",
    "utf8",
  );
  for (const permission of legacyPermissions) {
    assert.equal(TRACEPOINT_PERMISSIONS.includes(permission as never), false);
    assert.match(migration, new RegExp(permission));
  }
  assert.match(migration, /insert into public\.retired_permission_assignment_audit/g);
  assert.match(migration, /on conflict do nothing/g);
  assert.match(migration, /delete from public\.department_role_permissions[\s\S]*delete from public\.role_permissions[\s\S]*delete from public\.permissions/);
  assert.doesNotMatch(migration, /insert into public\.(?:department_)?role_permissions/);
  assert.doesNotMatch(migration, /delete from public\.audit_events/);
});
