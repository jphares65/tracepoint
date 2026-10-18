import assert from "node:assert/strict";
import test from "node:test";
import { REVISION_LOCKED_MESSAGE, revisionHasGeneratedDocuments, revisionLockedError, startTemplateRevision } from "./template-revisions";

const DEPT = "11111111-1111-4111-8111-111111111111", USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEMPLATE = "f0000000-0000-4000-8000-000000000001", V1 = "f0000000-0000-4000-8000-000000000002";
type Row = Record<string, unknown>;

/** In-memory tables with the query surface the revision code uses, including filtered update/delete and FK cascades. */
function world(options: { failInsertInto?: string; moveCurrentVersionDuringRevision?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    document_templates: [{ id: TEMPLATE, department_id: DEPT, status: "draft", current_version: 1 }],
    document_template_versions: [{ id: V1, department_id: DEPT, template_id: TEMPLATE, version_number: 1, source_filename: "q.pdf", source_storage_path: "store/q.pdf", created_by_user_id: USER }],
    document_template_fields: [
      { id: "field-1", department_id: DEPT, template_version_id: V1, page_number: 1, field_type: "tracepoint_data", canonical_key: "officer.full_name", label: "Officer Name", geometry: { x: 0.1, y: 0.1, width: 0.3, height: 0.03 }, formatting: { acroFieldName: "OfficerName", matchStatus: "confirmed" }, created_at: "t0", updated_at: "t0" },
      { id: "field-2", department_id: DEPT, template_version_id: V1, page_number: 1, field_type: "manual", label: "Remarks", geometry: { x: 0.1, y: 0.5, width: 0.8, height: 0.2 }, formatting: {}, created_at: "t0", updated_at: "t0" },
    ],
    document_template_structured_bindings: [{ id: "binding-1", department_id: DEPT, template_id: TEMPLATE, template_version_id: V1, section_key: "structured-section-x", source_type: "qualification_history", fill_mode: "sequential_cells", ordering: "date_desc", max_rows: 4, overflow_behavior: "require_review", filters: null, column_mappings: [{ target: "date" }], target_cells: [], created_at: "t0", updated_at: "t0" }],
    generated_documents: [],
    audit_events: [],
  };
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row | Row[] | null = null, max = Infinity;
      const matching = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const run = () => {
        if (op === "insert") {
          if (options.failInsertInto === table) return { data: null, error: { message: "insert failed" } };
          const rows = (Array.isArray(payload) ? payload : [payload!]).map((row) => ({ ...row }));
          (tables[table] ??= []).push(...rows);
          return { data: rows, error: null };
        }
        if (op === "update") {
          if (options.moveCurrentVersionDuringRevision && table === "document_templates") for (const row of tables[table]!) row.current_version = 99;
          const rows = matching();
          for (const row of rows) Object.assign(row, payload);
          return { data: rows, error: null };
        }
        if (op === "delete") {
          const rows = matching();
          tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
          if (table === "document_template_versions") for (const child of ["document_template_fields", "document_template_structured_bindings"]) tables[child] = tables[child]!.filter((row) => !rows.some((version) => version.id === row.template_version_id));
          return { data: rows, error: null };
        }
        return { data: matching().slice(0, max), error: null };
      };
      const builder = {
        select: () => builder,
        insert: (value: Row | Row[]) => { op = "insert"; payload = value; return builder; },
        update: (value: Row) => { op = "update"; payload = value; return builder; },
        delete: () => { op = "delete"; return builder; },
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        limit: (value: number) => { max = value; return builder; },
        maybeSingle: async () => { const result = run(); const rows = (result.data ?? []) as Row[]; return result.error ? result : { data: rows[0] ?? null, error: null }; },
        single: async () => { const result = run(); const rows = (result.data ?? []) as Row[]; return result.error ? result : rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not single" } }; },
        then: (resolve: (value: unknown) => unknown) => resolve(run()),
      };
      return builder;
    },
  };
  return { tables, db };
}
const generate = (tables: Record<string, Row[]>, versionId: string) => tables.generated_documents!.push({ id: crypto.randomUUID(), department_id: DEPT, template_id: TEMPLATE, template_version_id: versionId, context: { field_sources: [{ field_id: "field-1" }] } });
const snapshot = (rows: Row[]) => JSON.stringify(rows);

test("an unused revision is edited in place; no new revision is created", async () => {
  const { tables, db } = world();
  const result = await startTemplateRevision(db, { departmentId: DEPT, templateId: TEMPLATE, userId: USER });
  assert.deepEqual(result, { ok: true, revised: false, versionNumber: 1, versionId: V1 });
  assert.equal(tables.document_template_versions!.length, 1);
  assert.equal(await revisionLockedError(db, DEPT, TEMPLATE, 1), null);
});

test("a revision documents were generated from is frozen; editing moves to a copied revision", async () => {
  const { tables, db } = world();
  generate(tables, V1);
  const frozenFields = snapshot(tables.document_template_fields!), frozenBindings = snapshot(tables.document_template_structured_bindings!);

  const locked = await revisionLockedError(db, DEPT, TEMPLATE, 1);
  assert.deepEqual(locked, { error: REVISION_LOCKED_MESSAGE, status: 409, revisionLocked: true });

  const result = await startTemplateRevision(db, { departmentId: DEPT, templateId: TEMPLATE, userId: USER });
  assert.equal(result.ok && result.revised, true);
  if (!result.ok || !result.revised) return;
  assert.equal(result.versionNumber, 2);
  assert.equal(result.previousVersionId, V1);
  assert.equal(tables.document_templates![0]!.current_version, 2);

  // The new revision has copies (new ids, same decisions) of every field and binding.
  const copiedFields = tables.document_template_fields!.filter((row) => row.template_version_id === result.versionId);
  assert.deepEqual(copiedFields.map((row) => [row.label, row.canonical_key, JSON.stringify(row.formatting)]), [["Officer Name", "officer.full_name", JSON.stringify({ acroFieldName: "OfficerName", matchStatus: "confirmed" })], ["Remarks", undefined, "{}"]]);
  assert.ok(copiedFields.every((row) => row.id !== "field-1" && row.id !== "field-2"));
  const copiedBindings = tables.document_template_structured_bindings!.filter((row) => row.template_version_id === result.versionId);
  assert.equal(copiedBindings.length, 1);
  assert.equal(copiedBindings[0]!.section_key, "structured-section-x");

  // The frozen revision and the document's link to it are byte-for-byte unchanged.
  assert.equal(snapshot(tables.document_template_fields!.filter((row) => row.template_version_id === V1)), frozenFields);
  assert.equal(snapshot(tables.document_template_structured_bindings!.filter((row) => row.template_version_id === V1)), frozenBindings);
  assert.equal(tables.generated_documents![0]!.template_version_id, V1);
  assert.match(JSON.stringify(tables.audit_events!.at(-1)), /document_template_revision_started/);

  // The new revision is editable until a document is generated from it.
  assert.equal(await revisionLockedError(db, DEPT, TEMPLATE, 2), null);
  generate(tables, result.versionId);
  const again = await startTemplateRevision(db, { departmentId: DEPT, templateId: TEMPLATE, userId: USER });
  assert.equal(again.ok && again.revised && again.versionNumber, 3);
  assert.equal(new Set(tables.document_template_versions!.map((row) => row.version_number)).size, 3);
});

test("a failed copy or a concurrent change leaves the template on its existing revision and removes the partial one", async () => {
  for (const options of [{ failInsertInto: "document_template_structured_bindings" }, { moveCurrentVersionDuringRevision: true }]) {
    const { tables, db } = world(options);
    generate(tables, V1);
    const result = await startTemplateRevision(db, { departmentId: DEPT, templateId: TEMPLATE, userId: USER });
    assert.equal(result.ok, false, JSON.stringify(options));
    assert.deepEqual(tables.document_template_versions!.map((row) => row.id), [V1], "partial revision removed");
    assert.ok(tables.document_template_fields!.every((row) => row.template_version_id === V1), "copied fields removed with it");
    if (!options.moveCurrentVersionDuringRevision) assert.equal(tables.document_templates![0]!.current_version, 1);
  }
});

test("when generated documents cannot be checked, the revision is treated as locked", async () => {
  const failing = { from: () => ({ select: () => failing.chain, eq: () => failing.chain, limit: () => failing.chain, then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { message: "down" } }) }) } as unknown as { from(table: string): unknown; chain: unknown };
  failing.chain = (failing.from as () => unknown)();
  assert.equal(await revisionHasGeneratedDocuments(failing as never, DEPT, V1), null);
});
