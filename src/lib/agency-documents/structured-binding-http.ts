import { type JsonValue, type StructuredBindingInput, type StructuredBindingTargetCellRow, validateStructuredBinding } from "./structured-binding-repository";

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function integer(value: unknown): number { return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN; }
function jsonObject(value: unknown): { [key: string]: JsonValue } { if (!value || Array.isArray(value) || typeof value !== "object") return {}; return value as { [key: string]: JsonValue }; }
function cells(value: unknown): StructuredBindingTargetCellRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((cell) => {
    const candidate = cell && typeof cell === "object" ? cell as Record<string, unknown> : {};
    const geometry = candidate.geometry && typeof candidate.geometry === "object" ? candidate.geometry as Record<string, unknown> : {};
    return { page: integer(candidate.page), order: integer(candidate.order), row: integer(candidate.row), column: integer(candidate.column), source: text(candidate.source) || undefined, geometry: { x: Number(geometry.x), y: Number(geometry.y), width: Number(geometry.width), height: Number(geometry.height) } };
  });
}
export function normalizeStructuredBindingInput(value: unknown): StructuredBindingInput {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const columnMappings = Array.isArray(body.columnMappings) ? body.columnMappings.map((mapping) => { const source = mapping && typeof mapping === "object" ? mapping as Record<string, unknown> : {}; return { target: text(source.target) as StructuredBindingInput["columnMappings"][number]["target"], ...(text(source.dateFormat) ? { dateFormat: text(source.dateFormat) as "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD" } : {}) }; }) : [];
  const filters = jsonObject(body.filters);
  const normalized: StructuredBindingInput = { sectionKey: text(body.sectionKey), sourceType: text(body.sourceType) as "qualification_history", fillMode: text(body.fillMode) as StructuredBindingInput["fillMode"], ordering: text(body.ordering ?? body.sortOrder) as StructuredBindingInput["ordering"], maxRows: integer(body.maxRows ?? body.maxCells), overflowBehavior: text(body.overflowBehavior) as StructuredBindingInput["overflowBehavior"], filters: Object.keys(filters).length ? { ...(typeof filters.reportYear === "number" ? { reportYear: filters.reportYear } : {}), ...(typeof filters.courseNameIncludes === "string" ? { courseNameIncludes: filters.courseNameIncludes } : {}), ...(typeof filters.firearmType === "string" ? { firearmType: filters.firearmType } : {}), ...(typeof filters.mostRecent === "number" ? { mostRecent: filters.mostRecent } : {}) } : undefined, columnMappings, formatting: jsonObject(body.formatting), targetCells: cells(body.targetCells) };
  validateStructuredBinding(normalized);
  return normalized;
}
