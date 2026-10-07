import type { QualificationRecord, StructuredBinding } from "./structured-binding";
import { resolveStructuredBinding } from "./structured-binding";
import type { StructuredBindingTargetCellRow } from "./structured-binding-repository";

export type DocumentStructuredBinding = StructuredBinding & { id: string; sectionKey: string; targetCells: StructuredBindingTargetCellRow[] };
export type StructuredDocumentResolution = { fields: Array<{ pageNumber: number; value: string; geometry: StructuredBindingTargetCellRow["geometry"] }>; warnings: string[]; requiresReview: boolean; bindingIds: string[] };
export function resolveDocumentStructuredBindings(bindings: DocumentStructuredBinding[], qualifications: QualificationRecord[], reportYear?: number): StructuredDocumentResolution {
  const fields: StructuredDocumentResolution["fields"] = [], warnings: string[] = []; let requiresReview = false;
  for (const binding of bindings) {
    const filters = binding.filters?.reportYearMode === "document" && reportYear ? { ...binding.filters, reportYear } : binding.filters;
    const resolved = resolveStructuredBinding(qualifications, { ...binding, filters }, binding.targetCells);
    fields.push(...resolved.values.map((value, index) => ({ pageNumber: binding.targetCells[index]?.page ?? 1, value: value.value, geometry: value.geometry })));
    warnings.push(...resolved.warnings.map(warning => `${binding.sectionKey}: ${warning}`)); requiresReview ||= resolved.requiresReview;
  }
  return { fields, warnings, requiresReview, bindingIds: bindings.map(binding => binding.id) };
}
