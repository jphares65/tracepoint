import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getRoutePermissionRequirement } from "../tracepoint/permissions.ts";

test("all importer routes use authenticated active-department authority and administration permission", async () => {
  const files = await Promise.all(["interpret", "preview", "execute"].map((name) => readFile(`src/app/api/settings/ai-importer/${name}/route.ts`, "utf8")));
  for (const [index, source] of files.entries()) {
    assert.match(source, /resolveServerAccess\(\)/);
    assert.match(source, /administer_department/);
    assert.doesNotMatch(source, /body\.departmentId|payload\.departmentId|p_department_id/);
    if (index > 0) assert.match(source, /context\.departmentId/);
  }
});

test("preview is read-only and execution requires approval before invoking persistence", async () => {
  const [preview, execute] = await Promise.all([
    readFile("src/app/api/settings/ai-importer/preview/route.ts", "utf8"),
    readFile("src/app/api/settings/ai-importer/execute/route.ts", "utf8"),
  ]);
  assert.doesNotMatch(preview, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.ok(execute.indexOf("explicitApprovalComplete") < execute.indexOf("executeApprovedImport"));
  assert.ok(execute.indexOf("verifyApprovalToken") < execute.lastIndexOf("executeApprovedImport"));
  assert.ok(execute.indexOf("validateImport") < execute.lastIndexOf("executeApprovedImport"));
});

test("execution scopes every domain write, batches safely, audits results, and does not log sensitive rows", async () => {
  const source = await readFile("src/lib/ai-importer/server/execution.ts", "utf8");
  assert.match(source, /const BATCH_SIZE = 100/);
  assert.match(source, /ai_import_approved/);
  assert.match(source, /ai_import_completed/);
  assert.match(source, /raw_file_stored: false/);
  assert.match(source, /\.eq\("department_id", departmentId\)/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(source, /details:[\s\S]{0,300}row\.values/);
});

test("provider input minimizes data to headers and three representative rows", async () => {
  const source = await readFile("src/lib/ai-importer/provider.ts", "utf8");
  assert.match(source, /rows\.slice\(0, 3\)/);
  assert.doesNotMatch(source, /departmentId|department_id/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
});

test("classic and AI-assisted importers remain separate, additive choices", async () => {
  const [classic, assisted] = await Promise.all([
    readFile("src/app/settings/import-export/page.tsx", "utf8"),
    readFile("src/app/settings/import-export/ai-importer/page.tsx", "utf8"),
  ]);

  assert.match(classic, /Classic Import Mapper/);
  assert.match(classic, /Existing stable manual mapping workflow/);
  assert.match(classic, /Recommended for users who prefer full manual control/);
  assert.match(classic, /id="classic-import-mapper"/);
  assert.match(classic, /href="\/settings\/import-export\/ai-importer"/);
  assert.match(classic, /AI-Assisted Importer/);
  assert.match(classic, />\s*Beta\s*</);
  assert.match(classic, /AI-assisted import is currently in beta\. Review all proposed mappings and validation results before importing\./);

  for (const endpoint of ["personnel", "firearms", "certifications", "equipment", "off-duty-firearms", "qualification-history"]) {
    assert.match(classic, new RegExp(`/api/settings/onboarding/${endpoint}`));
  }
  assert.doesNotMatch(classic, /fetch\("\/api\/settings\/ai-importer/);
  assert.match(assisted, /fetch\("\/api\/settings\/ai-importer\/interpret/);
  assert.match(assisted, /fetch\("\/api\/settings\/ai-importer\/preview/);
  assert.match(assisted, /fetch\("\/api\/settings\/ai-importer\/execute/);
  assert.doesNotMatch(assisted, /\/api\/settings\/onboarding/);
});

test("classic and AI-assisted pages share the department-administration route gate", () => {
  assert.deepEqual(getRoutePermissionRequirement("/settings/import-export"), { anyOf: ["administer_department"] });
  assert.deepEqual(getRoutePermissionRequirement("/settings/import-export/ai-importer"), { anyOf: ["administer_department"] });
  assert.deepEqual(getRoutePermissionRequirement("/settings/import-export/migration"), { anyOf: ["administer_department"] });
});

test("multi-file workspace routes enforce active-department permission and never accept tenant authority from payloads", async () => {
  const files = await Promise.all([
    "src/app/api/settings/ai-importer/workspaces/route.ts",
    "src/app/api/settings/ai-importer/workspaces/[workspaceId]/route.ts",
    "src/app/api/settings/ai-importer/workspaces/[workspaceId]/preview/route.ts",
    "src/app/api/settings/ai-importer/workspaces/[workspaceId]/execute/route.ts",
  ].map((path) => readFile(path, "utf8")));
  for (const source of files) {
    assert.match(source, /resolveServerAccess\(\)/);
    assert.match(source, /administer_department/);
    assert.match(source, /context\.departmentId/);
    assert.doesNotMatch(source, /body\.departmentId|body\.department_id|p_department_id/);
    assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
  }
  assert.match(files[0], /form\.getAll\("files"\)/);
  assert.match(files[0], /parseWorkbook/);
  assert.match(files[2], /workspaceApprovalToken/);
  assert.ok(files[3].indexOf("verifyWorkspaceApprovalToken") < files[3].indexOf("executeApprovedImport"));
  assert.ok(files[3].indexOf("buildWorkspacePlans") < files[3].lastIndexOf("executeApprovedImport"));
  assert.match(files[1], /immutableSourcesMatch/);
  assert.match(files[1], /Staged source records are immutable/);
});

test("migration staging schema is additive, tenant isolated, expiring, and stores no raw file bytes", async () => {
  const migration = await readFile("supabase/migrations/202609070001_ai_migration_workspaces.sql", "utf8");
  assert.match(migration, /create table if not exists public\.ai_migration_workspaces/);
  assert.match(migration, /department_id uuid not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /has_department_permission\(department_id, 'administer_department'\)/);
  assert.match(migration, /expires_at/);
  assert.match(migration, /expire_ai_migration_workspaces/);
  assert.doesNotMatch(migration, /bytea|raw_file|workbook_bytes/);
});

test("all three beta-era import experiences remain additive", async () => {
  const [classic, single, migration] = await Promise.all([
    readFile("src/app/settings/import-export/page.tsx", "utf8"),
    readFile("src/app/settings/import-export/ai-importer/page.tsx", "utf8"),
    readFile("src/app/settings/import-export/migration/page.tsx", "utf8"),
  ]);
  assert.match(classic, /Classic Import Mapper/);
  assert.match(classic, /AI-Assisted Importer/);
  assert.match(classic, /Multi-File Migration/);
  assert.match(classic, /href="\/settings\/import-export\/migration"/);
  assert.match(single, /\/api\/settings\/ai-importer\/preview/);
  assert.match(migration, /\/api\/settings\/ai-importer\/workspaces/);
});

test("single-file execution revalidates override-bearing payloads and audit stores only remediation value fingerprints", async () => {
  const [route, execution] = await Promise.all([
    readFile("src/app/api/settings/ai-importer/execute/route.ts", "utf8"),
    readFile("src/lib/ai-importer/server/execution.ts", "utf8"),
  ]);
  assert.ok(route.indexOf("parseImportPayload(body.payload)") < route.indexOf("validateImport(payload"));
  assert.match(execution, /original_value_sha256/);
  assert.match(execution, /replacement_value_sha256/);
  assert.doesNotMatch(execution, /original_value:\s*override\.originalValue/);
  assert.doesNotMatch(execution, /replacement_value:\s*override\.replacementValue/);
});
