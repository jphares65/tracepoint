import { calendarDate } from "./calendar-date";
import { formatDate } from "./field-values";

export type QualificationPickerRow = { id: string; qualification_date?: string | Date | null; score?: number | string | null; passed?: boolean | null; historical_course_name?: string | null };

/** One entry in the generate page's qualification picker, labelled by its calendar date. */
export function qualificationPickerItem(row: QualificationPickerRow) {
  return {
    id: row.id,
    label: formatDate(calendarDate(row.qualification_date)) || "Undated",
    detail: [row.historical_course_name, row.score !== undefined && row.score !== null ? `Score ${row.score}` : "", row.passed === true ? "Pass" : row.passed === false ? "Fail" : ""].filter(Boolean).join(" · "),
  };
}
