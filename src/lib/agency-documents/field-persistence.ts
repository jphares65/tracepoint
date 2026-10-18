import { structuredSectionKey } from "./structured-binding-builder-state";

/**
 * Field identity rules.
 *
 * A template field keeps its id for as long as it exists, so saved review
 * decisions, generated-document provenance (generated_documents.context
 * field_sources) and anything else that refers to a field stays valid across
 * edits. Ids are never taken from the client unless they already belong to
 * this template version — a client cannot address another record.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SavePlan<T> = {
  /** Rows to upsert; existing ids are reused, new rows get fresh ids. */
  rows: Array<T & { id: string }>;
  /** Ids of this version's fields that are no longer present and must be removed. */
  staleIds: string[];
  /** Position in the request → id that was saved, so the client can adopt server ids for new fields. */
  ids: Array<{ index: number; id: string; created: boolean }>;
};

export function planFieldSave<T extends { id?: string | null }>(existingIds: Iterable<string>, incoming: readonly T[], newId: () => string = () => crypto.randomUUID()): SavePlan<Omit<T, "id">> {
  const existing = new Set(existingIds);
  const used = new Set<string>();
  const ids: SavePlan<T>["ids"] = [];
  const rows = incoming.map((field, index) => {
    const requested = typeof field.id === "string" && UUID.test(field.id) ? field.id.toLowerCase() : null;
    // Reuse only ids that belong to this version, once each (a duplicated id in one request becomes a new field).
    const reuse = requested && existing.has(requested) && !used.has(requested) ? requested : null;
    const id = reuse ?? newId();
    used.add(id);
    ids.push({ index, id, created: !reuse });
    const { id: _ignored, ...rest } = field;
    void _ignored;
    return { ...rest, id } as Omit<T, "id"> & { id: string };
  });
  return { rows, staleIds: [...existing].filter((id) => !used.has(id)), ids };
}

type Locatable = { id: string; formatting?: Record<string, unknown> | null };

/** A stable identity for a field derived from the form itself (native field name or Word placeholder). */
export function fieldLocator(field: { formatting?: Record<string, unknown> | null }): string | null {
  const formatting = field.formatting ?? {};
  if (typeof formatting.acroFieldName === "string" && formatting.acroFieldName) return `acro:${formatting.acroFieldName}`;
  const target = formatting.docxTarget as { part?: unknown; kind?: unknown; ordinal?: unknown; label?: unknown } | undefined;
  if (target && typeof target.part === "string" && typeof target.kind === "string" && typeof target.ordinal === "number") return `docx:${target.part}:${target.kind}:${target.ordinal}:${String(target.label ?? "")}`;
  return null;
}

/**
 * When a template is set up again from its form, fields that point at the same
 * place in the form keep their ids. Returns rows with ids rewritten and the
 * ids of existing fields that no longer correspond to anything.
 */
export function reuseIdsByLocator<T extends Locatable>(planned: readonly T[], existing: readonly Locatable[]) {
  const byLocator = new Map<string, string>();
  for (const field of existing) { const locator = fieldLocator(field); if (locator && !byLocator.has(locator)) byLocator.set(locator, field.id); }
  const kept = new Set<string>();
  const rows = planned.map((row) => {
    const locator = fieldLocator(row);
    const previous = locator ? byLocator.get(locator) : undefined;
    if (previous && !kept.has(previous)) { kept.add(previous); return { ...row, id: previous }; }
    return row;
  });
  return { rows, staleIds: existing.map((field) => field.id).filter((id) => !kept.has(id)) };
}

/**
 * Repeating sections detected on the form must be bound to TracePoint data or
 * explicitly dismissed before publishing; otherwise part of the form would be
 * silently left empty.
 */
export function structuredPublishBlockers(proposals: readonly { id: string; status: string; proposal: { kind?: string; detectedLabel?: string } }[], boundSectionKeys: Iterable<string>) {
  const bound = new Set(boundSectionKeys);
  return proposals
    .filter((row) => row.proposal?.kind === "structured_section" && (row.status === "proposed" || row.status === "modified") && !bound.has(structuredSectionKey(row.id)))
    .map((row) => ({ fieldId: "", message: `${row.proposal.detectedLabel || "Repeating section"}: bind it to TracePoint data or dismiss it.` }));
}
