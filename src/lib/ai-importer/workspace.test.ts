import assert from "node:assert/strict";
import test from "node:test";

import { workspaceApprovalToken, workspaceDigest } from "./fingerprint.ts";
import { buildWorkspacePlans, readyDomains, workspaceDashboard, WORKSPACE_DEPENDENCIES } from "./workspace.ts";
import type { ImportDomain, ImportReferenceData } from "./types.ts";
import type { MigrationWorkspaceState, WorkspaceSource } from "./workspace-types.ts";

const EMPTY: ImportReferenceData = { people: [], firearms: [], firearmAssignments: [], certificationTypes: [], certifications: [], vehicles: [], fleetEquipment: [], equipmentTypes: [], equipment: [] };
const REFERENCES = Object.fromEntries(["personnel", "firearms", "certifications", "vehicles", "equipment"].map((domain) => [domain, { ...EMPTY }])) as Record<ImportDomain, ImportReferenceData>;
let nextId = 1;

function source(domain: ImportDomain, filename: string, records: Record<string, string>[], modified = "2026-01-01T00:00:00.000Z"): WorkspaceSource {
  const fields = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const id = `${String(nextId++).padStart(8, "0")}-0000-4000-8000-000000000000`;
  return { id, fileId: `${String(nextId).padStart(8, "0")}-1111-4000-8000-000000000000`, file: { name: filename, size: 100, sha256: String(nextId).repeat(64).slice(0, 64), type: filename.endsWith("csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sheetCount: 1 }, sheetName: "Sheet1", matrix: [fields, ...records.map((record) => fields.map((field) => record[field] ?? ""))], domain, headerRow: 1, mappings: fields.map((field) => ({ sourceColumn: field, targetField: field, confidence: "High", samples: [] })), excluded: false, headerConfidence: "High", uploadedAt: modified };
}

function state(sources: WorkspaceSource[]): MigrationWorkspaceState { return { version: 1, sources, sharedMappings: [], remediations: [], mergeRules: [] }; }

test("multiple sources group by domain and exact cross-file duplicates require explicit approval", () => {
  const draft = state([source("personnel", "roster.xlsx", [{ badgeNumber: "10", firstName: "A", lastName: "B", email: "a@b.gov" }]), source("personnel", "command.csv", [{ badgeNumber: "10", firstName: "A", lastName: "B", email: "a@b.gov" }])]);
  let plans = buildWorkspacePlans(draft, REFERENCES);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].overlaps[0].classification, "exact_duplicate");
  assert.equal(plans[0].preview.summary.blocked, 1);
  draft.mergeRules.push({ domain: "personnel", groupKey: plans[0].overlaps[0].groupKey, strategy: "skip_exact_duplicates", approvedAt: new Date().toISOString() });
  plans = buildWorkspacePlans(draft, REFERENCES);
  assert.equal(plans[0].preview.summary.blocked, 0);
  assert.equal(plans[0].preview.summary.skip, 1);
});

test("conflicting duplicates support preferred-source, newest, nonblank, and field-level precedence", () => {
  const older = source("personnel", "old.csv", [{ badgeNumber: "20", firstName: "Jane", lastName: "Doe", email: "j@x.gov", rankTitle: "Sergeant", unitName: "" }], "2025-01-01T00:00:00.000Z");
  const newer = source("personnel", "new.csv", [{ badgeNumber: "20", firstName: "Jane", lastName: "Doe", email: "j@x.gov", rankTitle: "Lieutenant", unitName: "Patrol" }], "2026-01-01T00:00:00.000Z");
  const draft = state([older, newer]);
  let plan = buildWorkspacePlans(draft, REFERENCES)[0];
  assert.equal(plan.overlaps[0].classification, "conflicting_record");
  assert.equal(plan.overlaps[0].resolved, false);
  draft.mergeRules.push({ domain: "personnel", groupKey: plan.overlaps[0].groupKey, strategy: "preferred_source", preferredSourceId: newer.id, approvedAt: new Date().toISOString() });
  plan = buildWorkspacePlans(draft, REFERENCES)[0];
  assert.equal(plan.overlaps[0].resolved, true);
  assert.equal(plan.preview.rows[0].values.rankTitle, "Lieutenant");
  assert.equal(plan.preview.rows[0].values.unitName, "Patrol");
  const newestState = state([older, newer]); newestState.mergeRules.push({ domain: "personnel", strategy: "newest", approvedAt: new Date().toISOString() });
  assert.equal(buildWorkspacePlans(newestState, REFERENCES)[0].preview.rows[0].values.rankTitle, "Lieutenant");
  const fieldState = state([older, newer]);
  const fieldGroup = buildWorkspacePlans(fieldState, REFERENCES)[0].overlaps[0].groupKey;
  fieldState.mergeRules.push({ domain: "personnel", groupKey: fieldGroup, strategy: "field_source", field: "rankTitle", preferredSourceId: newer.id, approvedAt: new Date().toISOString() });
  const fieldPlan = buildWorkspacePlans(fieldState, REFERENCES)[0];
  assert.equal(fieldPlan.overlaps[0].resolved, true);
  assert.equal(fieldPlan.preview.rows[0].values.rankTitle, "Lieutenant");
  const complementary = state([
    source("personnel", "identity.csv", [{ badgeNumber: "30", firstName: "Alex", lastName: "Ray", email: "a@r.gov", unitName: "" }]),
    source("personnel", "assignment.csv", [{ badgeNumber: "30", firstName: "Alex", lastName: "Ray", email: "a@r.gov", unitName: "Patrol" }]),
  ]);
  let complementaryPlan = buildWorkspacePlans(complementary, REFERENCES)[0];
  assert.equal(complementaryPlan.overlaps[0].classification, "probable_same");
  complementary.mergeRules.push({ domain: "personnel", groupKey: complementaryPlan.overlaps[0].groupKey, strategy: "nonblank", approvedAt: new Date().toISOString() });
  complementaryPlan = buildWorkspacePlans(complementary, REFERENCES)[0];
  assert.equal(complementaryPlan.preview.rows[0].values.unitName, "Patrol");
  const existingState = state([older, newer]);
  existingState.mergeRules.push({ domain: "personnel", strategy: "existing", approvedAt: new Date().toISOString() });
  const existingReferences = structuredClone(REFERENCES);
  existingReferences.personnel.people = [{ userId: "existing", fullName: "Jane Doe", email: "j@x.gov", phone: null, badgeNumber: "20", employeeNumber: null, rankTitle: "Captain", unitName: null, active: true }];
  const existingPlan = buildWorkspacePlans(existingState, existingReferences)[0];
  assert.equal(existingPlan.overlaps[0].resolved, true);
  assert.ok(existingPlan.preview.rows.every((row) => row.action === "SKIP"));
});

test("stable identifiers detect the same firearm, VIN, equipment serial, and certification across files", () => {
  const certificationReference = { ...REFERENCES, certifications: { ...EMPTY, people: [{ userId: "u", fullName: "A B", email: "a@b.gov", phone: null, badgeNumber: "10", employeeNumber: null, rankTitle: null, unitName: null, active: true }], certificationTypes: [{ id: "ct", name: "CPR", is_active: true }] } };
  const cases: Array<[ImportDomain, Record<string, string>]> = [
    ["firearms", { serialNumber: "AB-1" }], ["vehicles", { unitNumber: "V1", vin: "1HGCM82633A004352" }],
    ["equipment", { equipmentType: "Radio", serialNumber: "R-1" }], ["certifications", { personnelIdentifier: "10", certificationTitle: "CPR", credentialNumber: "C-1" }],
  ];
  for (const [domain, row] of cases) {
    const refs = domain === "certifications" ? certificationReference : REFERENCES;
    if (domain === "equipment") refs.equipment.equipmentTypes = [{ id: "r", name: "Radio", is_active: true }];
    const plans = buildWorkspacePlans(state([source(domain, `${domain}-a.csv`, [row]), source(domain, `${domain}-b.xlsx`, [row])]), refs);
    assert.equal(plans[0].overlaps[0].classification, "exact_duplicate", domain);
  }
});

test("shared mappings and workspace remediation rules propagate across sources while exclusions stay out", () => {
  const one = source("personnel", "one.csv", [{ "Shield #": "1", firstName: "A", lastName: "One", email: "a@x.gov", active: "Y" }]);
  const two = source("personnel", "two.xlsx", [{ "Shield #": "2", firstName: "B", lastName: "Two", email: "b@x.gov", active: "Y" }]);
  one.mappings[0].targetField = null; two.mappings[0].targetField = null;
  const draft = state([one, two]);
  draft.sharedMappings.push({ domain: "personnel", sourceHeader: "Shield #", targetField: "badgeNumber", approvedAt: new Date().toISOString() });
  draft.remediations.push({ sourceId: one.id, rowNumber: 2, sourceColumn: "active", targetField: "active", originalValue: "Y", replacementValue: "Inactive", scope: "workspace", approvedAt: new Date().toISOString() });
  let plan = buildWorkspacePlans(draft, REFERENCES)[0];
  assert.equal(plan.preview.rows.length, 2);
  assert.ok(plan.preview.rows.every((row) => row.values.active === false));
  two.excluded = true;
  plan = buildWorkspacePlans(draft, REFERENCES)[0];
  assert.equal(plan.preview.rows.length, 1);
});

test("file-scoped remediation spans worksheets in one file but not another file", () => {
  const first = source("personnel", "book.xlsx", [{ badgeNumber: "41", firstName: "A", lastName: "One", email: "a41@x.gov", active: "Y" }]);
  const second = source("personnel", "book.xlsx", [{ badgeNumber: "42", firstName: "B", lastName: "Two", email: "a42@x.gov", active: "Y" }]);
  const other = source("personnel", "other.csv", [{ badgeNumber: "43", firstName: "C", lastName: "Three", email: "a43@x.gov", active: "Y" }]);
  second.fileId = first.fileId;
  const draft = state([first, second, other]);
  draft.remediations.push({ sourceId: first.id, rowNumber: 2, sourceColumn: "active", targetField: "active", originalValue: "Y", replacementValue: "Inactive", scope: "file", approvedAt: new Date().toISOString() });
  const rows = buildWorkspacePlans(draft, REFERENCES)[0].preview.rows;
  assert.deepEqual(rows.map((row) => row.values.active), [false, false, true]);
});

test("in-workspace personnel creates satisfy dependent certification and assignment validation", () => {
  const draft = state([
    source("personnel", "people.csv", [{ badgeNumber: "77", firstName: "Pat", lastName: "Lee", email: "p@x.gov" }]),
    source("certifications", "certs.csv", [{ personnelIdentifier: "77", certificationTitle: "CPR", credentialNumber: "C77" }]),
    source("firearms", "guns.csv", [{ serialNumber: "G77", assignedPersonnel: "77" }]),
    source("equipment", "gear.csv", [{ equipmentType: "Radio", serialNumber: "R77", assignedPersonnel: "77" }]),
  ]);
  const references = structuredClone(REFERENCES);
  references.certifications.certificationTypes = [{ id: "ct", name: "CPR", is_active: true }];
  references.certifications.people = [{ userId: "u1", fullName: "Existing Officer", email: null, phone: null, badgeNumber: "u1", employeeNumber: null, rankTitle: null, unitName: null, active: true }];
  references.equipment.equipmentTypes = [{ id: "et", name: "Radio", is_active: true }];
  const plans = buildWorkspacePlans(draft, references);
  assert.equal(plans.find((plan) => plan.domain === "certifications")?.preview.rows[0].values.userId, "workspace:2");
  assert.equal(plans.find((plan) => plan.domain === "firearms")?.preview.rows[0].values.assignedUserId, "workspace:2");
  assert.equal(plans.find((plan) => plan.domain === "equipment")?.preview.rows[0].values.assignedUserId, "workspace:2");
  assert.deepEqual(WORKSPACE_DEPENDENCIES.certifications, ["personnel"]);
  assert.equal(readyDomains(plans)[0], "personnel");
  const certificationOnly = buildWorkspacePlans(state([
    source("certifications", "historical-certs.csv", [{ personnelIdentifier: "u1", certificationTitle: "CPR", credentialNumber: "C78" }]),
  ]), references);
  assert.deepEqual(readyDomains(certificationOnly), ["certifications"], "a dependency without a staged domain is satisfied from current TracePoint references");
});

test("workspace dashboard, partial readiness, and approval token bind exact resumable state", () => {
  const draft = state([source("personnel", "people.csv", [{ badgeNumber: "1", firstName: "A", lastName: "B", email: "a@x.gov" }]), source("vehicles", "fleet.xlsx", [{ unitNumber: "V1" }])]);
  const plans = buildWorkspacePlans(draft, REFERENCES);
  const dashboard = workspaceDashboard(draft, plans);
  assert.deepEqual({ files: dashboard.files, domains: dashboard.domains, sourceRows: dashboard.sourceRows }, { files: 2, domains: 2, sourceRows: 2 });
  const digest = workspaceDigest("workspace", draft, plans.map((plan) => ({ domain: plan.domain, payload: plan.payload, rows: plan.preview.rows, summary: plan.preview.summary })));
  const token = workspaceApprovalToken("workspace", draft, digest, "dept", "actor");
  const changed = structuredClone(draft); changed.sources[0].excluded = true;
  assert.notEqual(token, workspaceApprovalToken("workspace", changed, digest, "dept", "actor"));
});
