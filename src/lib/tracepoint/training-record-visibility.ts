import type { TracePointPermission } from "./permissions.ts";

// TRN-26 / RNG-28: officers see their own training, certification, range and
// qualification records. Other officers' records need a permission whose
// responsibility covers them; administer_department covers all. The database
// policies in database/aws/048 enforce the same boundary.
export const CERTIFICATION_RECORD_PERMISSIONS = ["manage_certifications"] as const satisfies readonly TracePointPermission[];
export const AGENCY_TRAINING_RECORD_PERMISSIONS = ["manage_training"] as const satisfies readonly TracePointPermission[];
// Event attendance counts and training-requirement alerts are summaries.
export const AGENCY_TRAINING_SUMMARY_PERMISSIONS = ["manage_training", "view_command_dashboard"] as const satisfies readonly TracePointPermission[];
export const CERTIFICATION_SUMMARY_PERMISSIONS = ["manage_certifications", "view_command_dashboard", "view_analytics"] as const satisfies readonly TracePointPermission[];
export const RANGE_RECORD_PERMISSIONS = [
  "manage_range_days", "score_range_days", "manage_qualifications",
  "manage_training", "view_analytics", "view_command_dashboard",
] as const satisfies readonly TracePointPermission[];
// Matches the attachment download route's qualification evidence rule.
export const QUALIFICATION_EVIDENCE_PERMISSIONS = [
  "manage_qualifications", "manage_range_days", "score_range_days", "view_analytics",
] as const satisfies readonly TracePointPermission[];

type Row = Record<string, unknown>;

export function canViewDepartmentRecords(permissions: readonly string[], allowed: readonly TracePointPermission[]) {
  return permissions.includes("administer_department") || allowed.some((permission) => permissions.includes(permission));
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function owner(item: Row, keys: readonly string[]) {
  return text(keys.map((key) => item[key]).find((value) => value !== undefined && value !== null));
}

export function ownRows<T>(rows: readonly T[], userId: string, keys: readonly string[]): T[] {
  return userId ? rows.filter((row) => Boolean(row) && typeof row === "object" && owner(row as Row, keys) === userId) : [];
}

const OFFICER_KEYS = ["officerId", "officer_id", "officerUserId", "officer_user_id"] as const;
const PLANNING = ["rangeDays", "range_days", "drillLibrary", "drill_library", "rangeDayDrills", "range_day_drills"] as const;
const OFFICER_ROWS = ["rangeRoster", "range_roster", "results", "drill_run_results"] as const;
const MALFUNCTIONS = ["malfunctions", "firearm_malfunctions"] as const;
const REVISIONS = ["resultRevisions", "result_revisions"] as const;

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
}

/**
 * The range workspace is one document per department. For a caller without a
 * range-record permission it keeps planning data and only the caller's own
 * roster entries, results, malfunctions and result revisions. Anything else
 * the document holds is withheld. Such a caller cannot save the workspace
 * (authorizeRangeWorkspaceMutation requires a scoring permission).
 */
export function ownRangeWorkspace(workspace: unknown, userId: string) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return workspace ?? null;
  const source = workspace as Row;
  const filtered: Row = {};
  for (const key of PLANNING) if (key in source) filtered[key] = source[key];
  const ownResultIds = new Set<string>();
  for (const key of OFFICER_ROWS) {
    if (!(key in source)) continue;
    const rows = ownRows(list(source[key]), userId, OFFICER_KEYS);
    filtered[key] = rows;
    if (key === "results" || key === "drill_run_results") rows.forEach((row) => { if (text(row.id)) ownResultIds.add(text(row.id)); });
  }
  for (const key of MALFUNCTIONS) {
    if (!(key in source)) continue;
    filtered[key] = list(source[key]).filter((item) => {
      const officer = owner(item, OFFICER_KEYS);
      if (officer) return officer === userId;
      return Boolean(userId) && ownResultIds.has(owner(item, ["drillRunId", "drillRunResultId", "drill_run_result_id", "drill_run_id"]));
    });
  }
  for (const key of REVISIONS) {
    if (!(key in source)) continue;
    filtered[key] = list(source[key]).filter((item) => {
      const previous = item.previous && typeof item.previous === "object" ? item.previous as Row : {};
      return Boolean(userId) && owner(previous, OFFICER_KEYS) === userId;
    });
  }
  return filtered;
}
