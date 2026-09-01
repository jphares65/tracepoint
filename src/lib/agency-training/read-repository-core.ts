export type AgencyTrainingRow = Record<string, unknown>;
export type AgencyTrainingResult = {
  data: AgencyTrainingRow[] | null;
  error: { message: string } | null;
};

export interface AgencyTrainingReadDataSource {
  listInstructorMemberships(departmentId: string): PromiseLike<AgencyTrainingResult>;
  listProfiles(userIds: string[]): PromiseLike<AgencyTrainingResult>;
  listRequirements(departmentId: string): PromiseLike<AgencyTrainingResult>;
  listEvents(departmentId: string): PromiseLike<AgencyTrainingResult>;
}

export class AgencyTrainingReadAuthorizationError extends Error {
  constructor() {
    super("Authorized department context is required.");
    this.name = "AgencyTrainingReadAuthorizationError";
  }
}

export class AgencyTrainingReadRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgencyTrainingReadRepositoryError";
  }
}

export class AgencyTrainingReadConfigurationError extends Error {
  constructor(provider: string) {
    super(`Unsupported data provider: ${provider}. Only supabase is implemented.`);
    this.name = "AgencyTrainingReadConfigurationError";
  }
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

function rows(result: AgencyTrainingResult) {
  if (result.error) throw new AgencyTrainingReadRepositoryError(result.error.message);
  return result.data ?? [];
}

export function requireAgencyTrainingReadProvider(provider: string | undefined) {
  const value = provider?.trim().toLowerCase() || "supabase";
  if (value !== "supabase") throw new AgencyTrainingReadConfigurationError(value);
  return value;
}

export function mapAgencyTrainingEvent(row: AgencyTrainingRow) {
  const attendees = (Array.isArray(row.agency_training_attendees) ? row.agency_training_attendees : []) as AgencyTrainingRow[];
  const instructors = (Array.isArray(row.agency_training_event_instructors) ? row.agency_training_event_instructors : []) as AgencyTrainingRow[];
  const lead = instructors.find((instructor: AgencyTrainingRow) => instructor.is_lead);
  return {
    id: row.id, title: row.title, courseId: row.course_id, trainingType: row.training_type,
    category: row.category, description: row.description, topics: row.topics ?? [],
    location: row.location, startsAt: row.starts_at, endsAt: row.ends_at,
    defaultHours: row.default_hours, status: row.status,
    certificationTypeId: row.certification_type_id,
    certificationValidDays: row.certification_valid_days,
    certificateEnabled: row.certificate_enabled, certificateTitle: row.certificate_title,
    lessonPlanRequired: row.lesson_plan_required, notes: row.notes, closedAt: row.closed_at,
    createdAt: row.created_at, updatedAt: row.updated_at, attendeeCount: attendees.length,
    completedCount: attendees.filter((attendee: AgencyTrainingRow) => ["completed", "passed"].includes(String(attendee.outcome_status))).length,
    instructorCount: instructors.length, leadInstructorUserId: lead?.user_id ?? null,
    leadInstructor: lead?.display_name ?? instructors[0]?.display_name ?? null,
    leadInstructorOrganization: lead?.organization ?? null,
    leadInstructorCredentials: lead?.credentials ?? null,
    leadInstructorRole: lead?.instructor_role ?? null,
    additionalInstructors: instructors.filter((instructor: AgencyTrainingRow) => !instructor.is_lead).map((instructor: AgencyTrainingRow) => ({
      userId: instructor.user_id, displayName: instructor.display_name,
      organization: instructor.organization, credentials: instructor.credentials,
      instructorRole: instructor.instructor_role,
    })),
  };
}

export class TenantBoundAgencyTrainingReadRepository {
  private readonly source: AgencyTrainingReadDataSource;
  private readonly authorizedDepartmentId: string;

  constructor(source: AgencyTrainingReadDataSource, authorizedDepartmentId: string) {
    if (!authorizedDepartmentId) throw new AgencyTrainingReadAuthorizationError();
    this.source = source;
    this.authorizedDepartmentId = authorizedDepartmentId;
  }

  private authorize(departmentId: string) {
    if (!departmentId || departmentId !== this.authorizedDepartmentId) {
      throw new AgencyTrainingReadAuthorizationError();
    }
  }

  async listInstructors(input: { departmentId: string }) {
    this.authorize(input.departmentId);
    const memberships = rows(await this.source.listInstructorMemberships(input.departmentId));
    const userIds = memberships.map((row) => String(row.user_id));
    const profiles = userIds.length ? rows(await this.source.listProfiles(userIds)) : [];
    const profileMap = new Map(profiles.map((profile) => [String(profile.id), profile]));
    return memberships.map((membership) => ({
      userId: String(membership.user_id),
      fullName: text(profileMap.get(String(membership.user_id))?.full_name) || text(membership.rank_title) || "Unnamed Member",
      badgeNumber: text(membership.badge_number) || null,
      rankTitle: text(membership.rank_title) || null,
      unitName: text(membership.unit_name) || null,
    })).sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  async listRequirements(input: { departmentId: string }) {
    this.authorize(input.departmentId);
    return rows(await this.source.listRequirements(input.departmentId));
  }

  async listEvents(input: { departmentId: string }) {
    this.authorize(input.departmentId);
    return rows(await this.source.listEvents(input.departmentId)).map(mapAgencyTrainingEvent);
  }
}
