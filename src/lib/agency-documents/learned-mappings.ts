import type { LearnedMapping } from "./field-matcher";
import { getDocumentField } from "./field-registry";

type StoredField = { field_type: string; canonical_key: string | null; formatting?: Record<string, unknown> | null; template_name?: string | null };

/**
 * Derive reusable label → field decisions from fields the agency has already
 * confirmed on other templates. A label is only learned when every confirmed
 * use agrees; conflicting decisions are ignored so the matcher falls back to
 * its own rules rather than picking a side.
 */
export function learnedMappingsFromFields(rows: readonly StoredField[]): LearnedMapping[] {
  const decisions = new Map<string, { keys: Set<string | null>; templateName?: string }>();
  for (const row of rows) {
    const label = typeof row.formatting?.normalizedLabel === "string" ? row.formatting.normalizedLabel.trim() : "";
    if (!label || row.formatting?.matchStatus === "suggested") continue;
    let key: string | null;
    if (row.field_type === "tracepoint_data" && row.canonical_key && getDocumentField(row.canonical_key)) key = row.canonical_key;
    else if (row.field_type === "manual") key = null;
    else continue;
    const entry = decisions.get(label) ?? { keys: new Set<string | null>(), templateName: row.template_name ?? undefined };
    entry.keys.add(key);
    decisions.set(label, entry);
  }
  return [...decisions.entries()].filter(([, entry]) => entry.keys.size === 1).map(([normalizedLabel, entry]) => ({ normalizedLabel, key: [...entry.keys][0] ?? null, templateName: entry.templateName }));
}
