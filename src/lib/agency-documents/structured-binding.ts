import { calendarDate } from "./calendar-date";
import type { FieldGeometry } from "./template-core";

export type QualificationRecord = { id: string; date: string; courseName?: string; result?: string; score?: number; instructor?: string; firearmType?: string };
export type StructuredBinding = { sourceType: "qualification_history"; fillMode: "rows" | "columns" | "sequential_cells"; ordering: "date_asc" | "date_desc"; maxRows: number; overflowBehavior: "truncate_with_warning" | "require_review" | "error"; columnMappings: { target: "date" | "course_name" | "result" | "score" | "instructor"; dateFormat?: "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD" }[]; filters?: { reportYear?: number; reportYearMode?: "document" | "specific" | "none"; courseNameIncludes?: string; firearmType?: string; mostRecent?: number } };
export type StructuredCell = { geometry: FieldGeometry; row: number; column: number; page?: number };
/** `record` is the 0-based position of the record in the section, `page` the page its cell is on. */
export type StructuredResolution = { values: { geometry: FieldGeometry; value: string; page: number; record: number }[]; warnings: string[]; requiresReview: boolean };

export function orderedStructuredCells(cells: StructuredCell[]) { return [...cells].sort((a, b) => (a.page ?? 1) - (b.page ?? 1) || a.row - b.row || a.column - b.column || a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x); }
export function formatQualificationDate(value: string, format: "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD" = "MM/DD/YYYY") { const date = calendarDate(value); if (!date) return ""; const [year, month, day] = date.split("-") as [string, string, string]; return format === "YYYY-MM-DD" ? `${year}-${month}-${day}` : `${month}/${day}/${format === "MM/DD/YY" ? year.slice(-2) : year}`; }
function field(record: QualificationRecord, target: StructuredBinding["columnMappings"][number]["target"], format?: "MM/DD/YYYY" | "MM/DD/YY" | "YYYY-MM-DD") { if (target === "date") return formatQualificationDate(record.date, format); if (target === "course_name") return record.courseName ?? ""; if (target === "result") return record.result ?? ""; if (target === "score") return record.score == null ? "" : String(record.score); return record.instructor ?? ""; }

/**
 * Groups target cells into one slot per record. With one mapped column every cell is a slot, in reading order.
 * With several, consecutive cells form a slot and must share a row ("rows", "sequential_cells") or a column
 * ("columns"). A layout that does not line up is refused rather than guessed, so a record is never split across
 * rows and a later record never shifts into an earlier record's row.
 */
export function recordSlots(cells: StructuredCell[], binding: Pick<StructuredBinding, "fillMode" | "columnMappings">): StructuredCell[][] {
  const width = Math.max(1, binding.columnMappings.length);
  const byColumn = binding.fillMode === "columns";
  const ordered = byColumn
    ? [...cells].sort((a, b) => (a.page ?? 1) - (b.page ?? 1) || a.column - b.column || a.row - b.row || a.geometry.x - b.geometry.x || a.geometry.y - b.geometry.y)
    : orderedStructuredCells(cells);
  if (ordered.length % width !== 0) throw new StructuredLayoutError(`The repeating section has ${ordered.length} cells, which is not a whole number of ${width}-column records.`);
  const line = (cell: StructuredCell) => `${cell.page ?? 1}:${byColumn ? cell.column : cell.row}`;
  const slots: StructuredCell[][] = [];
  for (let start = 0; start < ordered.length; start += width) {
    const slot = ordered.slice(start, start + width);
    if (width > 1 && slot.some((cell) => line(cell) !== line(slot[0]!))) throw new StructuredLayoutError(`Record ${slots.length + 1} of the repeating section would span more than one ${byColumn ? "column" : "row"}.`);
    slots.push(slot);
  }
  return slots;
}

export function resolveStructuredBinding(records: QualificationRecord[], binding: StructuredBinding, cells: StructuredCell[]): StructuredResolution {
  let selected = records.filter(record => { const year = record.date.slice(0, 4); return (!binding.filters?.reportYear || year === String(binding.filters.reportYear)) && (!binding.filters?.courseNameIncludes || record.courseName?.toLowerCase().includes(binding.filters.courseNameIncludes.toLowerCase())) && (!binding.filters?.firearmType || record.firearmType === binding.filters.firearmType); });
  selected.sort((a, b) => binding.ordering === "date_asc" ? a.date.localeCompare(b.date) || a.id.localeCompare(b.id) : b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  if (binding.filters?.mostRecent) selected = selected.slice(0, binding.filters.mostRecent);
  const slots = recordSlots(cells, binding);
  const fits = Math.min(binding.maxRows, slots.length);
  const overflow = selected.length > fits;
  // Say how many records are left out, so the person generating knows exactly what the document will not show.
  const message = `Structured binding exceeds available cells: ${selected.length} matching records, room for ${fits}; ${selected.length - fits} will not be printed.`;
  if (overflow && binding.overflowBehavior === "error") throw new StructuredOverflowError(message);
  const values = selected.slice(0, fits).flatMap((record, index) => binding.columnMappings.map((mapping, column) => {
    const cell = slots[index]![column]!;
    return { geometry: cell.geometry, page: cell.page ?? 1, record: index, value: field(record, mapping.target, mapping.dateFormat) };
  }));
  // Records that do not fit are never left out silently: whatever the overflow setting, an official document
  // cannot be issued until the section is changed to hold them (fail closed for the pilot).
  return { values, warnings: overflow ? [message] : [], requiresReview: overflow };
}

/** A binding set to stop with an error ("error") has more matching records than it has room for. */
export class StructuredOverflowError extends Error {
  constructor(message: string) { super(message); this.name = "StructuredOverflowError"; }
}

/** The target cells of a repeating section cannot be matched to whole records. */
export class StructuredLayoutError extends Error {
  constructor(message: string) { super(message); this.name = "StructuredLayoutError"; }
}
