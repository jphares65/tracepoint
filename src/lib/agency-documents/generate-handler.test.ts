import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { handleGenerate, type GenerateDeps } from "./generate-handler";
import { analyzeTemplateDocx, analyzeTemplatePdf } from "./template-analyzer";
import { planAutomaticSetup } from "./proposal-review";
import { docxText } from "./docx-forms";
import { buildQualificationForm } from "./__fixtures__/synthetic-forms";
import { buildQualificationDocx } from "./__fixtures__/synthetic-docx";

const DEPT = "11111111-1111-4111-8111-111111111111", OTHER_DEPT = "22222222-2222-4222-8222-222222222222";
const OFFICER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", SERGEANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", FOREIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FIREARM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", QUAL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TEMPLATE = "f0000000-0000-4000-8000-000000000001", VERSION = "f0000000-0000-4000-8000-000000000002";
const DOCX_TEMPLATE = "f0000000-0000-4000-8000-000000000003", DOCX_VERSION = "f0000000-0000-4000-8000-000000000004";

type Row = Record<string, unknown>;

async function world() {
  const pdf = await buildQualificationForm();
  const docx = buildQualificationDocx();
  const pdfRows = planAutomaticSetup((await analyzeTemplatePdf(pdf)).proposals).rows.map((row) => ({ ...row, formatting: { ...row.formatting, matchStatus: "confirmed" }, department_id: DEPT, template_version_id: VERSION }));
  const docxRows = planAutomaticSetup(analyzeTemplateDocx(docx).proposals).rows.map((row) => ({ ...row, formatting: { ...row.formatting, matchStatus: "confirmed" }, department_id: DEPT, template_version_id: DOCX_VERSION }));
  const tables: Record<string, Row[]> = {
    document_templates: [
      { id: TEMPLATE, department_id: DEPT, name: "Annual Qualification", status: "published", current_version: 1 },
      { id: DOCX_TEMPLATE, department_id: DEPT, name: "Word Qualification", status: "published", current_version: 1 },
    ],
    document_template_versions: [
      { id: VERSION, department_id: DEPT, template_id: TEMPLATE, version_number: 1, source_filename: "q.pdf", source_storage_path: "pdf-path" },
      { id: DOCX_VERSION, department_id: DEPT, template_id: DOCX_TEMPLATE, version_number: 1, source_filename: "q.docx", source_storage_path: "docx-path" },
    ],
    document_template_fields: [...pdfRows, ...docxRows],
    document_template_structured_bindings: [],
    departments: [{ id: DEPT, name: "Lakeview Township Police Department", short_name: "Lakeview PD", timezone: "America/New_York" }],
    department_memberships: [
      { department_id: DEPT, user_id: OFFICER, badge_number: "4471", rank_title: "Patrol Officer", is_active: true, profiles: { full_name: "Jordan A. Rivera", email: null } },
      { department_id: DEPT, user_id: SERGEANT, badge_number: "1102", rank_title: "Sergeant", is_active: true, profiles: { full_name: "Casey Morgan", email: null } },
      { department_id: OTHER_DEPT, user_id: FOREIGN, badge_number: "9", rank_title: "Officer", is_active: true, profiles: { full_name: "Other Agency Person", email: null } },
    ],
    firearms: [{ id: FIREARM, department_id: DEPT, make: "Example Arms", model: "EA-19", serial_number: "EXA123456", caliber: "9mm", asset_number: null, firearm_type: "handgun", archived_at: null }],
    firearm_assignments: [{ department_id: DEPT, firearm_id: FIREARM, assigned_to_user_id: OFFICER, returned_at: null }],
    qualification_results: [{ id: QUAL, department_id: DEPT, officer_user_id: OFFICER, qualification_date: "2026-03-14", score: 287, passed: true, qualification_course_id: null, instructor_user_id: null, historical_course_name: "Day Handgun Course", historical_instructor_name: "Taylor Brooks" }],
    generated_documents: [],
    audit_events: [],
  };
  const uploads: Array<{ fileName: string; bytes: Uint8Array; contentType: string }> = [];
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let insertRows: Row[] | null = null;
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
        order: () => builder,
        insert: (payload: Row | Row[]) => { insertRows = Array.isArray(payload) ? payload : [payload]; (tables[table] ??= []).push(...insertRows); return builder; },
        maybeSingle: async () => { const found = rows(); return found.length > 1 ? { data: null, error: { message: "multiple" } } : { data: found[0] ?? null, error: null }; },
        single: async () => { const found = rows(); return found.length === 1 ? { data: found[0], error: null } : { data: null, error: { message: "not single" } }; },
        then: (resolve: (value: { data: Row[] | null; error: null }) => unknown) => resolve({ data: insertRows ?? rows(), error: null }),
      };
      return builder;
    },
  };
  const deps = (options: { permissions?: string[]; userId?: string } = {}): GenerateDeps => ({
    resolveAccess: async () => ({ ok: true, context: { admin: db, departmentId: DEPT, userId: options.userId ?? SERGEANT } }),
    hasPermission: (_context, permissions) => permissions.some((permission) => (options.permissions ?? ["generate_agency_documents"]).includes(permission)),
    denied: (message) => Response.json({ error: message }, { status: 403 }),
    attachmentPath: (stored) => stored,
    store: () => ({
      createAttachmentView: async (path) => ({ signedUrl: `memory://${path}`, error: null }),
      uploadGeneratedAgencyDocument: async (input) => { uploads.push(input); return { path: `generated/${input.fileName}`, error: null }; },
    }),
    fetch: async (url) => new Response(url.endsWith("docx-path") ? docx : pdf),
  });
  return { tables, deps, uploads, pdfRows, docxRows };
}

const post = (body: unknown) => new Request("http://local/api/agency-documents/generate", { method: "POST", body: JSON.stringify(body) });
const context = { personId: OFFICER, firearmId: FIREARM, qualificationId: QUAL };

test("review shows the selected officer's data — never the generating sergeant's", async () => {
  const { deps } = await world();
  const response = await handleGenerate(post({ templateId: TEMPLATE, mode: "review", context }), deps());
  assert.equal(response.status, 200);
  const body = await response.json();
  const values = Object.fromEntries(body.fields.map((field: { label: string; value: string }) => [field.label, field.value]));
  assert.equal(values["Officer Name"], "Jordan A. Rivera");
  assert.equal(values["Badge No"], "4471");
  assert.ok(!JSON.stringify(body.fields).includes("Casey Morgan"));
  // All manual fields on this form are optional, so with every selection made the document is ready.
  assert.equal(body.ready, true, JSON.stringify(body.missing));
});

test("final generation is refused until complete, then saves, audits and returns the completed PDF", async () => {
  const { deps, tables, uploads } = await world();
  // Without an officer selection the officer fields are missing → refused.
  const refused = await handleGenerate(post({ templateId: TEMPLATE, mode: "final", context: { firearmId: FIREARM, qualificationId: QUAL } }), deps());
  assert.equal(refused.status, 409);
  const refusal = await refused.json();
  assert.ok(refusal.missing.some((item: { label: string }) => item.label === "Officer Name"));
  assert.equal(tables.generated_documents.length, 0);

  const ok = await handleGenerate(post({ templateId: TEMPLATE, mode: "final", context }), deps());
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json().catch(() => ({}))));
  assert.equal(ok.headers.get("Content-Type"), "application/pdf");
  const bytes = new Uint8Array(await ok.arrayBuffer());
  assert.equal(uploads.length, 1);
  assert.equal(tables.generated_documents.length, 1);
  const saved = tables.generated_documents[0]!;
  assert.deepEqual((saved.context as { references: Row }).references, { person_id: OFFICER, firearm_id: FIREARM, qualification_id: QUAL });
  assert.equal(tables.audit_events.at(-1)!.action, "document_generated");
  const text = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(bytes) });
  if (text.status === 0) {
    const printed = text.stdout.toString();
    for (const expected of ["Jordan A. Rivera", "4471", "EXA123456", "03/14/2026", "Taylor Brooks", "Lakeview Township Police Department"]) assert.ok(printed.includes(expected), expected);
    assert.ok(!printed.includes("Casey Morgan"));
  }
});

test("typed values are used only for their own field and are not copied into the audit record", async () => {
  const { deps, tables } = await world();
  const caseField = (await (await handleGenerate(post({ templateId: TEMPLATE, mode: "review", context }), deps())).json()).fields.find((field: { label: string }) => field.label === "Case Number");
  const response = await handleGenerate(post({ templateId: TEMPLATE, mode: "final", context, entered: { [caseField.fieldId]: "26-SECRET-1" } }), deps());
  assert.equal(response.status, 200);
  assert.ok(!JSON.stringify(tables.generated_documents).includes("26-SECRET-1"));
  assert.ok(!JSON.stringify(tables.audit_events).includes("26-SECRET-1"));
});

test("tenant isolation: other agencies' templates and people are unavailable", async () => {
  const { deps } = await world();
  const missingTemplate = await handleGenerate(post({ templateId: "99999999-9999-4999-8999-999999999999", mode: "review" }), deps());
  assert.equal(missingTemplate.status, 404);
  const foreign = await handleGenerate(post({ templateId: TEMPLATE, mode: "review", context: { personId: FOREIGN } }), deps());
  assert.equal(foreign.status, 409);
  assert.match((await foreign.json()).error, /not an active member/);
});

test("permissions and draft status are enforced", async () => {
  const { deps, tables } = await world();
  const denied = await handleGenerate(post({ templateId: TEMPLATE, mode: "review" }), deps({ permissions: ["view_agency_documents"] }));
  assert.equal(denied.status, 403);
  tables.document_templates[0]!.status = "draft";
  const generatorOnDraft = await handleGenerate(post({ templateId: TEMPLATE, mode: "preview", context }), deps());
  assert.equal(generatorOnDraft.status, 409);
  const managerPreview = await handleGenerate(post({ templateId: TEMPLATE, mode: "preview", context }), deps({ permissions: ["manage_document_templates"] }));
  assert.equal(managerPreview.status, 200);
  const managerFinal = await handleGenerate(post({ templateId: TEMPLATE, mode: "final", context }), deps({ permissions: ["manage_document_templates"] }));
  assert.equal(managerFinal.status, 409);
});

test("Word templates generate a completed .docx through the same path", async () => {
  const { deps } = await world();
  const response = await handleGenerate(post({ templateId: DOCX_TEMPLATE, mode: "final", context }), deps());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json().catch(() => ({}))));
  assert.match(response.headers.get("Content-Type") ?? "", /wordprocessingml/);
  const text = docxText(new Uint8Array(await response.arrayBuffer()));
  assert.ok(text.includes("Officer: Jordan A. Rivera"));
  assert.ok(text.includes("Badge Number: 4471"));
  const preview = await handleGenerate(post({ templateId: DOCX_TEMPLATE, mode: "preview", context }), deps());
  assert.ok((await preview.json()).previewHtml.includes("<mark>Jordan A. Rivera</mark>"));
});

test("malformed requests fail cleanly", async () => {
  const { deps } = await world();
  assert.equal((await handleGenerate(post({}), deps())).status, 400);
  const garbage = await handleGenerate(new Request("http://local", { method: "POST", body: "{not json" }), deps());
  assert.equal(garbage.status, 400);
});
