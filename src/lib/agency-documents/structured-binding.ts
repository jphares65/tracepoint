import type { FieldGeometry } from "./template-core";

export type QualificationRecord = { id: string; date: string; courseName?: string; result?: string; score?: number; instructor?: string; firearmType?: string };
export type StructuredBinding = { sourceType: "qualification_history"; fillMode: "rows" | "columns" | "sequential_cells"; ordering: "date_asc" | "date_desc"; maxRows: number; overflowBehavior: "truncate_with_warning" | "require_review" | "error"; columnMappings: { target: "date" | "course_name" | "result" | "score" | "instructor"; dateFormat?: "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD" }[]; filters?: { reportYear?: number; courseNameIncludes?: string; firearmType?: string; mostRecent?: number } };
export type StructuredCell = { geometry: FieldGeometry; row: number; column: number };
export type StructuredResolution = { values: { geometry: FieldGeometry; value: string }[]; warnings: string[]; requiresReview: boolean };

export function orderedStructuredCells(cells: StructuredCell[]) { return [...cells].sort((a, b) => a.row - b.row || a.column - b.column || a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x); }
export function formatQualificationDate(value: string, format: "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD" = "MM/DD/YYYY") { const date = new Date(`${value}T00:00:00Z`); if (Number.isNaN(date.getTime())) return ""; const year = String(date.getUTCFullYear()), month = String(date.getUTCMonth() + 1).padStart(2, "0"), day = String(date.getUTCDate()).padStart(2, "0"); return format === "YYYY-MM-DD" ? `${year}-${month}-${day}` : `${month}/${day}/${format === "MM/DD/YY" ? year.slice(-2) : year}`; }
function field(record: QualificationRecord, target: StructuredBinding["columnMappings"][number]["target"], format?: "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD") { if (target === "date") return formatQualificationDate(record.date, format); if (target === "course_name") return record.courseName ?? ""; if (target === "result") return record.result ?? ""; if (target === "score") return record.score == null ? "" : String(record.score); return record.instructor ?? ""; }
export function resolveStructuredBinding(records: QualificationRecord[], binding: StructuredBinding, cells: StructuredCell[]): StructuredResolution {
  let selected = records.filter(record => { const year = record.date.slice(0, 4); return (!binding.filters?.reportYear || year === String(binding.filters.reportYear)) && (!binding.filters?.courseNameIncludes || record.courseName?.toLowerCase().includes(binding.filters.courseNameIncludes.toLowerCase())) && (!binding.filters?.firearmType || record.firearmType === binding.filters.firearmType); });
  selected.sort((a, b) => binding.ordering === "date_asc" ? a.date.localeCompare(b.date) || a.id.localeCompare(b.id) : b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  if (binding.filters?.mostRecent) selected = selected.slice(0, binding.filters.mostRecent);
  const targets = orderedStructuredCells(cells), values = selected.slice(0, binding.maxRows).flatMap(record => binding.columnMappings.map(mapping => field(record, mapping.target, mapping.dateFormat))).slice(0, targets.length);
  const overflow = selected.length * binding.columnMappings.length > targets.length || selected.length > binding.maxRows;
  if (overflow && binding.overflowBehavior === "error") throw new Error("Structured binding exceeds available cells.");
  return { values: values.map((value, index) => ({ geometry: targets[index]!.geometry, value })), warnings: overflow ? ["Structured binding exceeds available cells."] : [], requiresReview: overflow && binding.overflowBehavior === "require_review" };
}
