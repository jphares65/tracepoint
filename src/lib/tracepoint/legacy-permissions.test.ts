import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { effectiveDepartmentPermissions } from "./permission-authority.ts";
import {
  getRoutePermissionRequirement,
  meetsPermissionRequirement,
  TRACEPOINT_PERMISSIONS,
  TRAINING_ALERTS_GENERATED_READ_PERMISSIONS,
  TRAINING_ALERTS_MODULE_PERMISSIONS,
  TRAINING_ALERTS_REMEDIATION_READ_PERMISSIONS,
  TRAINING_ALERTS_REMEDIATION_WRITE_PERMISSIONS,
  type TracePointPermission,
} from "./permissions.ts";

const LEGACY_PERMISSIONS = [
  "create_remediations",
  "manage_remediations",
  "resolve_remediations",
  "view_training_alerts",
  "manage_training_alerts",
  "view_command_training_alerts",
] as const;

type LegacyPermission = (typeof LEGACY_PERMISSIONS)[number];

const SUSPECTED_BROADER_PERMISSION: Record<
  LegacyPermission,
  TracePointPermission
> = {
  create_remediations: "manage_training",
  manage_remediations: "manage_training",
  resolve_remediations: "manage_training",
  view_training_alerts: "view_analytics",
  manage_training_alerts: "manage_training",
  view_command_training_alerts: "view_analytics",
};

type SurfaceResult = {
  navigation: boolean;
  directPage: boolean;
  generatedAlertsApi: boolean;
  remediationReadApi: boolean;
  remediationWriteApi: boolean;
  completeClientLoad: boolean;
};

function surfaceResult(permissions: TracePointPermission[]): SurfaceResult {
  const moduleRequirement = {
    anyOf: TRAINING_ALERTS_MODULE_PERMISSIONS,
  };
  const generatedAlertsApi = meetsPermissionRequirement(permissions, {
    anyOf: TRAINING_ALERTS_GENERATED_READ_PERMISSIONS,
  });
  const remediationReadApi = meetsPermissionRequirement(permissions, {
    anyOf: TRAINING_ALERTS_REMEDIATION_READ_PERMISSIONS,
  });

  return {
    navigation: meetsPermissionRequirement(permissions, moduleRequirement),
    directPage: meetsPermissionRequirement(
      permissions,
      getRoutePermissionRequirement("/training-alerts"),
    ),
    generatedAlertsApi,
    remediationReadApi,
    remediationWriteApi: meetsPermissionRequirement(permissions, {
      anyOf: TRAINING_ALERTS_REMEDIATION_WRITE_PERMISSIONS,
    }),
    completeClientLoad: generatedAlertsApi && remediationReadApi,
  };
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(candidate);
      if (!entry.isFile() || !/\.(?:ts|tsx|mjs|sql)$/.test(entry.name)) {
        return [];
      }
      return [candidate];
    }),
  );
  return nested.flat();
}

test("legacy codes are excluded from the application authority and executable schema", async () => {
  for (const code of LEGACY_PERMISSIONS) {
    assert.equal(TRACEPOINT_PERMISSIONS.includes(code as never), false, code);
    assert.deepEqual(effectiveDepartmentPermissions([], [code]), [], code);
  }

  const runtimeFiles = (await sourceFiles("src"))
    .filter((file) => !file.endsWith(".test.ts"));
  const migrationFiles = await sourceFiles("supabase/migrations");
  const expression = new RegExp(LEGACY_PERMISSIONS.join("|"));

  for (const file of [...runtimeFiles, ...migrationFiles]) {
    assert.doesNotMatch(await readFile(file, "utf8"), expression, file);
  }
});

test("the disposable application matrix proves legacy-only and both equal no-legacy behavior", () => {
  const denied: SurfaceResult = {
    navigation: false,
    directPage: false,
    generatedAlertsApi: false,
    remediationReadApi: false,
    remediationWriteApi: false,
    completeClientLoad: false,
  };
  const administratorPermissions = effectiveDepartmentPermissions(
    ["administrator"],
    [],
  );

  assert.deepEqual(surfaceResult(administratorPermissions), {
    navigation: true,
    directPage: true,
    generatedAlertsApi: true,
    remediationReadApi: true,
    remediationWriteApi: true,
    completeClientLoad: true,
  });

  for (const legacyPermission of LEGACY_PERMISSIONS) {
    const broaderPermission = SUSPECTED_BROADER_PERMISSION[legacyPermission];
    const legacyOnly = effectiveDepartmentPermissions([], [legacyPermission]);
    const broaderOnly = effectiveDepartmentPermissions([], [broaderPermission]);
    const both = effectiveDepartmentPermissions(
      [],
      [legacyPermission, broaderPermission],
    );

    assert.deepEqual(surfaceResult(legacyOnly), denied, `${legacyPermission}: legacy only`);
    assert.deepEqual(both, broaderOnly, `${legacyPermission}: legacy is filtered from both`);
    assert.deepEqual(
      surfaceResult(both),
      surfaceResult(broaderOnly),
      `${legacyPermission}: both permissions`,
    );
    assert.deepEqual(surfaceResult([]), denied, `${legacyPermission}: neither`);

    if (broaderPermission === "manage_training") {
      assert.deepEqual(surfaceResult(broaderOnly), {
        navigation: true,
        directPage: true,
        generatedAlertsApi: false,
        remediationReadApi: true,
        remediationWriteApi: true,
        completeClientLoad: false,
      });
    } else {
      assert.deepEqual(surfaceResult(broaderOnly), {
        navigation: true,
        directPage: true,
        generatedAlertsApi: true,
        remediationReadApi: true,
        remediationWriteApi: false,
        completeClientLoad: true,
      });
    }
  }
});

test("navigation, page, and APIs consume the shared current authority without changing behavior", async () => {
  const [navigation, page, performanceApi, remediationApi] = await Promise.all([
    readFile("src/app/components/TracePointShell.tsx", "utf8"),
    readFile("src/app/training-alerts/page.tsx", "utf8"),
    readFile("src/app/api/pilot/performance-summary/route.ts", "utf8"),
    readFile("src/app/api/pilot/remediations/route.ts", "utf8"),
  ]);

  assert.match(navigation, /TRAINING_ALERTS_MODULE_PERMISSIONS/);
  assert.match(page, /TRAINING_ALERTS_MODULE_PERMISSIONS/);
  assert.match(performanceApi, /TRAINING_ALERTS_GENERATED_READ_PERMISSIONS/);
  assert.match(remediationApi, /TRAINING_ALERTS_REMEDIATION_READ_PERMISSIONS/);
  assert.match(remediationApi, /TRAINING_ALERTS_REMEDIATION_WRITE_PERMISSIONS/);
});

test("alert management is browser-local while remediation writes are bulk API persistence", async () => {
  const client = await readFile(
    "src/app/training-alerts/TrainingAlertsClient.tsx",
    "utf8",
  );

  assert.match(client, /TRAINING_ALERTS_STORAGE_KEY[\s\S]*window\.localStorage\.setItem/);
  assert.match(client, /updateAlertStatus\([\s\S]*setAlerts/);
  assert.match(client, />\s*Acknowledge\s*</);
  assert.match(client, />\s*Resolve\s*</);
  assert.match(client, /"Create Remediation"/);
  assert.match(client, />\s*Escalate\s*</);
  assert.match(client, /fetch\("\/api\/pilot\/remediations"[\s\S]*method: "PUT"/);
  assert.doesNotMatch(client, /PermissionGate|manage_training_alerts|view_command_training_alerts/);
});

test("RPC, RLS, notifications, and generated types do not enforce legacy codes", async () => {
  const [migrations, notifications, generatedTypes, foundation] = await Promise.all([
    Promise.all((await sourceFiles("supabase/migrations")).map((file) => readFile(file, "utf8"))).then((files) => files.join("\n")),
    readFile("src/app/api/notifications/route.ts", "utf8"),
    readFile("src/lib/supabase/database.types.ts", "utf8"),
    readFile("supabase/migrations/202606220001_tracepoint_foundation.sql", "utf8"),
  ]);
  const expression = new RegExp(LEGACY_PERMISSIONS.join("|"));

  assert.doesNotMatch(migrations, expression);
  assert.doesNotMatch(notifications, expression);
  assert.doesNotMatch(generatedTypes, expression);
  assert.match(foundation, /alerts_insert_manager[\s\S]*view_command_dashboard[\s\S]*manage_firearms[\s\S]*manage_range_days/);
  assert.match(foundation, /'remedial_training_recommendations'/);
  assert.match(foundation, /Scoring, observations, and remediation\.[\s\S]*score_range_days[\s\S]*manage_qualifications/);
});

test("the inactive retirement proposal archives first, is idempotent, and adds no broader grants", async () => {
  const proposal = await readFile(
    "supabase/proposals/202609050003_retire_legacy_training_alert_permissions.sql",
    "utf8",
  );

  assert.match(proposal, /INACTIVE PROPOSAL/);
  assert.match(proposal, /create table if not exists public\.retired_permission_assignment_audit/);
  assert.match(proposal, /create unique index if not exists/);
  assert.match(proposal, /on conflict do nothing/g);
  assert.match(proposal, /insert into public\.retired_permission_assignment_audit[\s\S]*delete from public\.department_role_permissions/);
  assert.match(proposal, /delete from public\.role_permissions[\s\S]*delete from public\.permissions/);
  assert.doesNotMatch(proposal, /insert into public\.(?:department_)?role_permissions/);
  assert.doesNotMatch(proposal, /delete from public\.audit_events/);
});
