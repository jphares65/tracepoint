import type { AgencyTrainingReadDataSource, AgencyTrainingResult } from "./read-repository-core.ts";

export const EVENT_FIELDS = ["id", "title", "course_id", "training_type", "category", "description", "topics", "location", "starts_at", "ends_at", "default_hours", "status", "certification_type_id", "certification_valid_days", "certificate_enabled", "certificate_title", "lesson_plan_required", "notes", "closed_at", "created_at", "updated_at", "agency_training_attendees(id,outcome_status)", "agency_training_event_instructors(id,user_id,display_name,organization,credentials,instructor_role,is_lead)"].join(",");

export type AgencyTrainingQuery = PromiseLike<AgencyTrainingResult> & {
  select(fields: string): AgencyTrainingQuery;
  eq(column: string, value: unknown): AgencyTrainingQuery;
  in(column: string, values: string[]): AgencyTrainingQuery;
  order(column: string, options: { ascending: boolean }): AgencyTrainingQuery;
};
export type AgencyTrainingClient = { from(table: string): AgencyTrainingQuery };

export class SupabaseAgencyTrainingReadDataSource implements AgencyTrainingReadDataSource {
  private readonly client: AgencyTrainingClient;
  constructor(client: AgencyTrainingClient) { this.client = client; }
  listInstructorMemberships(id: string) { return this.client.from("department_memberships").select("user_id,badge_number,rank_title,unit_name").eq("department_id", id).eq("is_active", true); }
  listProfiles(ids: string[]) { return this.client.from("profiles").select("id,full_name").in("id", ids); }
  listRequirements(id: string) { return this.client.from("agency_training_requirements").select("*,agency_training_courses(id,canonical_title)").eq("department_id", id).order("requirement_name", { ascending: true }); }
  listEvents(id: string) { return this.client.from("agency_training_events").select(EVENT_FIELDS).eq("department_id", id).order("starts_at", { ascending: false }); }
}
