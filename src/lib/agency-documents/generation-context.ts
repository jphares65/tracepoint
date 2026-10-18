import type { AgencySource, FirearmSource, GenerationSources, PersonSource, PreparerSource, QualificationSource } from "./field-values";

/**
 * Loads the records explicitly selected for a document, scoped to the active
 * department. Each lookup is tenant-filtered; a record from another agency is
 * reported as unavailable rather than silently ignored.
 *
 * Fixes relative to the previous version:
 * - firearms has no is_active column (archived_at is used), so firearm lookups no longer always fail;
 * - course and instructor come from qualification_courses / the instructor's
 *   membership, falling back to preserved historical text, instead of columns that do not exist;
 * - agency name comes from the departments row, never a "TracePoint Department" placeholder.
 */

type Result = { data: Record<string, unknown> | null; error: unknown };
type Query = { select: (columns: string) => Query; eq: (column: string, value: unknown) => Query; is: (column: string, value: unknown) => Query; maybeSingle: () => PromiseLike<Result> };
export type GenerationDatabase = { from: (table: string) => Query };

export type GenerationSelection = { personId?: string; firearmId?: string; qualificationId?: string };

export class GenerationContextError extends Error {
  constructor(message: string) { super(message); this.name = "GenerationContextError"; }
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "") || null;
const uuid = (value: unknown) => (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim()) ? value.trim() : null);

async function member(db: GenerationDatabase, departmentId: string, userId: string): Promise<PersonSource | null> {
  const row = await db.from("department_memberships").select("user_id,badge_number,rank_title,profiles!inner(full_name,email)").eq("department_id", departmentId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (row.error || !row.data) return null;
  const profile = (row.data.profiles ?? null) as { full_name?: string | null; email?: string | null } | null;
  return { id: String(row.data.user_id), fullName: text(profile?.full_name) ?? "", email: text(profile?.email), badgeNumber: text(row.data.badge_number), rankTitle: text(row.data.rank_title) };
}

export async function loadGenerationSources(db: GenerationDatabase, departmentId: string, selection: GenerationSelection, preparer: PreparerSource, options: { today?: string; reportYear?: number | null; now?: Date } = {}): Promise<GenerationSources> {
  const department = await db.from("departments").select("name,short_name,timezone").eq("id", departmentId).maybeSingle();
  if (department.error) throw new GenerationContextError("Agency details could not be loaded.");
  const today = options.today ?? todayInZone(text(department.data?.timezone) ?? undefined, options.now);
  const reportYear = options.reportYear;
  const agency: AgencySource = { name: text(department.data?.name), shortName: text(department.data?.short_name) };

  let person: PersonSource | null = null;
  if (selection.personId) {
    const id = uuid(selection.personId);
    person = id ? await member(db, departmentId, id) : null;
    if (!person) throw new GenerationContextError("The selected officer is not an active member of this agency.");
  }

  let firearm: FirearmSource | null = null;
  if (selection.firearmId) {
    const id = uuid(selection.firearmId);
    const row = id ? await db.from("firearms").select("id,make,model,serial_number,caliber,asset_number,firearm_type").eq("department_id", departmentId).eq("id", id).is("archived_at", null).maybeSingle() : { data: null, error: null };
    if (row.error || !row.data) throw new GenerationContextError("The selected firearm is not available in this agency.");
    const assignment = await db.from("firearm_assignments").select("assigned_to_user_id").eq("department_id", departmentId).eq("firearm_id", id).is("returned_at", null).maybeSingle();
    // More than one open assignment (an error from maybeSingle) is treated as "unknown", never guessed.
    const assignedId = !assignment.error && assignment.data ? uuid(assignment.data.assigned_to_user_id) : null;
    const assignee = assignedId ? await member(db, departmentId, assignedId) : null;
    firearm = { id: String(row.data.id), make: text(row.data.make), model: text(row.data.model), serialNumber: text(row.data.serial_number), caliber: text(row.data.caliber), assetNumber: text(row.data.asset_number), firearmType: text(row.data.firearm_type), assignedOfficerName: assignee?.fullName || null };
    // A firearm assigned to someone other than the selected officer is allowed (spare or pool weapons);
    // "Assigned officer" always shows the actual assignee, never the selected officer.
  }

  let qualification: QualificationSource | null = null;
  if (selection.qualificationId) {
    const id = uuid(selection.qualificationId);
    const row = id ? await db.from("qualification_results").select("id,officer_user_id,qualification_date,score,passed,qualification_course_id,instructor_user_id,historical_course_name,historical_instructor_name").eq("department_id", departmentId).eq("id", id).maybeSingle() : { data: null, error: null };
    if (row.error || !row.data) throw new GenerationContextError("The selected qualification is not available in this agency.");
    if (person && uuid(row.data.officer_user_id) !== person.id) throw new GenerationContextError("The selected qualification belongs to a different officer.");
    let courseName = text(row.data.historical_course_name);
    const courseId = uuid(row.data.qualification_course_id);
    if (courseId) {
      const course = await db.from("qualification_courses").select("name").eq("department_id", departmentId).eq("id", courseId).maybeSingle();
      courseName = text(course.data?.name) ?? courseName;
    }
    let instructorName = text(row.data.historical_instructor_name);
    const instructorId = uuid(row.data.instructor_user_id);
    if (instructorId) instructorName = (await member(db, departmentId, instructorId))?.fullName || instructorName;
    qualification = { id: String(row.data.id), date: text(row.data.qualification_date), score: row.data.score === null || row.data.score === undefined ? null : (row.data.score as number | string), passed: typeof row.data.passed === "boolean" ? row.data.passed : null, courseName, instructorName };
  }

  return { person, firearm, qualification, agency, preparer, reportYear: reportYear ?? null, today };
}

/** Today's date (yyyy-mm-dd) in the agency's time zone, so a late-night document is not dated tomorrow. */
export function todayInZone(timeZone = "America/New_York", now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The generating user's own details, read from their membership — never derived from an email address. */
export async function loadPreparer(db: GenerationDatabase, departmentId: string, userId: string): Promise<PreparerSource> {
  const id = uuid(userId);
  const self = id ? await member(db, departmentId, id) : null;
  return { fullName: self?.fullName || null, badgeNumber: self?.badgeNumber ?? null, rankTitle: self?.rankTitle ?? null };
}
