/**
 * Template revisions are immutable once used. A generated document records the exact
 * document_template_versions row it was filled from; that revision's fields and
 * repeating-section bindings must never change afterwards, or the document's field
 * provenance could no longer be reconstructed.
 *
 * Editing a used template therefore happens on a new revision: its fields and bindings
 * are copied to version N+1 and the template's current_version moves to it. The old
 * revision, and every document generated from it, is left exactly as it was.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = { from(table: string): any };
/* eslint-enable @typescript-eslint/no-explicit-any */

export const REVISION_LOCKED_MESSAGE = "Documents have been generated from this revision of the template, so it can no longer change. Start a new revision to edit it.";

type Row = Record<string, unknown>;

/** True when any generated document references the revision; null when that could not be checked. */
export async function revisionHasGeneratedDocuments(admin: Db, departmentId: string, versionId: string): Promise<boolean | null> {
  const used = await admin.from("generated_documents").select("id").eq("department_id", departmentId).eq("template_version_id", versionId).limit(1);
  if (used.error) return null;
  return (used.data ?? []).length > 0;
}

/**
 * For edit routes: a 409 body when the template's current revision is locked (or cannot be checked), otherwise null.
 * Fails closed: an unverifiable revision is treated as locked.
 */
export async function revisionLockedError(admin: Db, departmentId: string, templateId: string, currentVersion: number): Promise<{ error: string; status: number; revisionLocked?: true } | null> {
  const version = await admin.from("document_template_versions").select("id").eq("department_id", departmentId).eq("template_id", templateId).eq("version_number", currentVersion).maybeSingle();
  if (version.error || !version.data) return { error: "The template version could not be loaded.", status: 500 };
  const used = await revisionHasGeneratedDocuments(admin, departmentId, String(version.data.id));
  if (used === null) return { error: "The template revision could not be checked.", status: 500 };
  return used ? { error: REVISION_LOCKED_MESSAGE, status: 409, revisionLocked: true } : null;
}

export type RevisionResult =
  | { ok: true; revised: false; versionNumber: number; versionId: string }
  | { ok: true; revised: true; versionNumber: number; versionId: string; previousVersionNumber: number; previousVersionId: string }
  | { ok: false; error: string; status: number };

/**
 * Makes the template's current revision editable. When documents were generated from it, copies it to a new
 * revision and moves current_version there; otherwise returns the current revision unchanged.
 * The switch is conditional on current_version not having moved meanwhile; on any failure the partly created
 * revision is removed (fields and bindings cascade) and the template keeps pointing at its existing revision.
 */
export async function startTemplateRevision(admin: Db, input: { departmentId: string; templateId: string; userId: string }): Promise<RevisionResult> {
  const { departmentId, templateId, userId } = input;
  const template = await admin.from("document_templates").select("id,current_version").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error) return { ok: false, error: "The template could not be loaded.", status: 500 };
  if (!template.data) return { ok: false, error: "Template not found.", status: 404 };
  const currentNumber = Number(template.data.current_version);
  const current = await admin.from("document_template_versions").select("*").eq("department_id", departmentId).eq("template_id", templateId).eq("version_number", currentNumber).maybeSingle();
  if (current.error || !current.data) return { ok: false, error: "The template version could not be loaded.", status: 500 };
  const used = await revisionHasGeneratedDocuments(admin, departmentId, String(current.data.id));
  if (used === null) return { ok: false, error: "The template revision could not be checked.", status: 500 };
  if (!used) return { ok: true, revised: false, versionNumber: currentNumber, versionId: String(current.data.id) };

  const versions = await admin.from("document_template_versions").select("version_number").eq("department_id", departmentId).eq("template_id", templateId);
  if (versions.error) return { ok: false, error: "Template revisions could not be loaded.", status: 500 };
  const nextNumber = Math.max(currentNumber, ...((versions.data ?? []) as Row[]).map((row) => Number(row.version_number))) + 1;
  const created = await admin.from("document_template_versions").insert({ id: crypto.randomUUID(), department_id: departmentId, template_id: templateId, version_number: nextNumber, source_filename: current.data.source_filename, source_storage_path: current.data.source_storage_path, created_by_user_id: userId }).select("id").single();
  if (created.error || !created.data) return { ok: false, error: "A new template revision could not be created.", status: 500 };
  const newVersionId = String(created.data.id);
  const abandon = async (error: string): Promise<RevisionResult> => {
    await admin.from("document_template_versions").delete().eq("id", newVersionId).eq("department_id", departmentId);
    return { ok: false, error, status: 500 };
  };

  const fields = await admin.from("document_template_fields").select("*").eq("department_id", departmentId).eq("template_version_id", current.data.id);
  if (fields.error) return abandon("Template fields could not be copied to the new revision.");
  if ((fields.data ?? []).length) {
    // Copies get new ids; the frozen revision keeps the ids its documents' provenance refers to.
    const copied = await admin.from("document_template_fields").insert(((fields.data ?? []) as Row[]).map((stored) => { const field = { ...stored }; delete field.id; delete field.created_at; delete field.updated_at; return { ...field, id: crypto.randomUUID(), department_id: departmentId, template_version_id: newVersionId }; }));
    if (copied.error) return abandon("Template fields could not be copied to the new revision.");
  }
  const bindings = await admin.from("document_template_structured_bindings").select("*").eq("department_id", departmentId).eq("template_version_id", current.data.id);
  if (bindings.error) return abandon("Repeating sections could not be copied to the new revision.");
  if ((bindings.data ?? []).length) {
    const copied = await admin.from("document_template_structured_bindings").insert(((bindings.data ?? []) as Row[]).map((stored) => { const binding = { ...stored }; delete binding.id; delete binding.created_at; delete binding.updated_at; return { ...binding, id: crypto.randomUUID(), department_id: departmentId, template_version_id: newVersionId, created_by_user_id: userId, updated_by_user_id: userId }; }));
    if (copied.error) return abandon("Repeating sections could not be copied to the new revision.");
  }

  const moved = await admin.from("document_templates").update({ current_version: nextNumber, updated_by_user_id: userId, updated_at: new Date().toISOString() }).eq("id", templateId).eq("department_id", departmentId).eq("current_version", currentNumber).select("id");
  if (moved.error || !(moved.data ?? []).length) return abandon("The template changed while a new revision was being created. Reload and try again.");
  await admin.from("audit_events").insert({ department_id: departmentId, actor_user_id: userId, action: "document_template_revision_started", entity_type: "document_template", entity_id: templateId, summary: `Started revision ${nextNumber} of a document template; revision ${currentNumber} is kept unchanged for documents generated from it.`, new_value: { previous_version_number: currentNumber, previous_version_id: current.data.id, version_number: nextNumber, version_id: newVersionId } });
  return { ok: true, revised: true, versionNumber: nextNumber, versionId: newVersionId, previousVersionNumber: currentNumber, previousVersionId: String(current.data.id) };
}
