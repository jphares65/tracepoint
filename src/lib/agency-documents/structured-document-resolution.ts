import type { QualificationRecord, StructuredBinding } from "./structured-binding";
import { resolveStructuredBinding, StructuredLayoutError, StructuredOverflowError } from "./structured-binding";
import type { StructuredBindingTargetCellRow } from "./structured-binding-repository";

export type DocumentStructuredBinding = StructuredBinding & { id: string; sectionKey: string; targetCells: StructuredBindingTargetCellRow[] };
export type StructuredDocumentResolution = { fields: Array<{ pageNumber: number; value: string; geometry: StructuredBindingTargetCellRow["geometry"]; formatting: { align: "center"; autoFit: true; fontSize: number } }>; warnings: string[]; requiresReview: boolean; bindingIds: string[] };
export function resolveDocumentStructuredBindings(bindings: DocumentStructuredBinding[], qualifications: QualificationRecord[], reportYear?: number): StructuredDocumentResolution {
  const fields: StructuredDocumentResolution["fields"] = [], warnings: string[] = []; let requiresReview = false;
  for (const binding of bindings) {
    const filters = binding.filters?.reportYearMode === "document" && reportYear ? { ...binding.filters, reportYear } : binding.filters;
    let resolved;
    try { resolved = resolveStructuredBinding(qualifications, { ...binding, filters }, binding.targetCells); }
    catch (error) { throw error instanceof StructuredOverflowError ? new StructuredOverflowError(`${binding.sectionKey}: ${error.message}`) : error instanceof StructuredLayoutError ? new StructuredLayoutError(`${binding.sectionKey}: ${error.message}`) : error; }
    // The page travels with the cell the value was placed in (target cells are stored in no particular order).
    fields.push(...resolved.values.map((value) => ({ pageNumber: value.page, value: value.value, geometry: value.geometry, formatting: { align: "center" as const, autoFit: true as const, fontSize: 10 } })));
    warnings.push(...resolved.warnings.map(warning => `${binding.sectionKey}: ${warning}`)); requiresReview ||= resolved.requiresReview;
  }
  return { fields, warnings, requiresReview, bindingIds: bindings.map(binding => binding.id) };
}
