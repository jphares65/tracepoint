import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// server-access is server-only, so these follow module-access.test.ts in src/lib/tracepoint and read the sources.
test("the Agency Documents module check is the agency_documents feature entitlement", async () => {
  const helper = await readFile("src/lib/agency-documents/module-access.ts", "utf8");
  assert.match(helper, /requireServerFeature\(context, MODULE_FEATURE\.AGENCY_DOCUMENTS, "Agency Documents"\)/);
  const catalog = await readFile("src/lib/tracepoint/module-catalog.ts", "utf8");
  assert.match(catalog, /AGENCY_DOCUMENTS: "agency_documents"/);
});

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? routeFiles(path.join(directory, entry.name)) : Promise.resolve(entry.name === "route.ts" ? [path.join(directory, entry.name)] : [])));
  return nested.flat();
}

test("every Agency Documents API handler checks the module entitlement right after resolving access", async () => {
  const files = await routeFiles("src/app/api/agency-documents");
  assert.ok(files.length >= 12);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
    const accessChecks = source.match(/await resolveServerAccess\(\)/g) ?? [];
    const moduleChecks = source.match(/agencyDocumentsDisabledResponse\(access\.context\)/g) ?? [];
    assert.ok(handlers.length > 0, `${file} exports a handler`);
    assert.equal(accessChecks.length, handlers.length, `${file}: one access check per handler`);
    assert.equal(moduleChecks.length, handlers.length, `${file}: one module check per handler`);
  }
});

test("Agency Documents pages and navigation are gated by the module", async () => {
  const [layout, shell] = await Promise.all([
    readFile("src/app/agency-documents/layout.tsx", "utf8"),
    readFile("src/app/components/TracePointShell.tsx", "utf8"),
  ]);
  assert.match(layout, /hasAnyServerPermission\(resolved\.context, \[\s+"view_agency_documents",\s+"generate_agency_documents",\s+"manage_document_templates",\s+\]\)/);
  assert.match(layout, /if \(agencyDocumentsDisabledResponse\(resolved\.context\)\) \{\s+redirect\("\/"\);/);
  assert.match(shell, /label: "Agency Documents",\s+href: "\/agency-documents",\s+icon: FileText,\s+featureCode: MODULE_FEATURE\.AGENCY_DOCUMENTS,/);
});
