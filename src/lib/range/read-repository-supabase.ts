import type { RangeReadDataSource, RangeReadResult } from "./read-repository-core.ts";
export type RangeQuery = PromiseLike<RangeReadResult> & { select(value: string): RangeQuery; eq(key: string, value: unknown): RangeQuery; in(key: string, values: string[]): RangeQuery; order(key: string, options?: { ascending?: boolean }): RangeQuery; maybeSingle(): RangeQuery };
export type RangeClient = { from(table: string): RangeQuery };
export class SupabaseRangeReadDataSource implements RangeReadDataSource {
  private readonly client: RangeClient;
  constructor(client: RangeClient) { this.client = client; }
  getRangeWorkspace(id: string) { return this.client.from("pilot_range_workspaces").select("department_id, workspace, updated_at, updated_by_user_id").eq("department_id", id).maybeSingle(); }
  listStandards(id: string) { return this.client.from("department_qualification_standards").select("id, name, firearm_type").eq("department_id", id).eq("is_active", true).order("name"); }
  listStandardComponents(id: string) { return this.client.from("department_qualification_standard_components").select("qualification_standard_id, name, scoring_basis, passing_score, passing_time_seconds, minimum_hits, is_required").eq("department_id", id).eq("is_active", true).order("sort_order").order("name"); }
  listMemberships(id: string) { return this.client.from("department_memberships").select("user_id, badge_number, rank_title, unit_name, employee_number, is_active, joined_at").eq("department_id", id).eq("is_active", true).order("rank_title", { ascending: true }).order("joined_at", { ascending: true }); }
  listProfiles(ids: string[]) { return this.client.from("profiles").select("id, full_name, email").in("id", ids); }
  listRoles(id: string, ids: string[]) { return this.client.from("department_membership_roles").select("user_id, role_code").eq("department_id", id).in("user_id", ids); }
  getAmmunitionWorkspace(id: string) { return this.client.from("pilot_ammunition_workspaces").select("workspace, updated_at").eq("department_id", id).maybeSingle(); }
  getRemediationWorkspace(id: string) { return this.client.from("pilot_remediation_workspaces").select("remediations, updated_at").eq("department_id", id).maybeSingle(); }
  listQualificationResults(id: string) { return this.client.from("qualification_results").select("id, officer_user_id, qualification_date, lighting_condition, score, passed, expires_on, notes").eq("department_id", id); }
  listRangeDays(id: string) { return this.client.from("range_days").select("id, title, range_date, status, range_type, packet_status").eq("department_id", id); }
  listRangeDayDrills(id: string) { return this.client.from("range_day_drills").select("id, range_day_id, name, category, scoring_format, passing_score, max_score, passing_time_seconds").eq("department_id", id); }
  listDrillResults(id: string) { return this.client.from("drill_run_results").select("id, range_day_id, range_day_drill_id, officer_user_id, run_number, scoring_format_snapshot, completed, score, time_seconds, hit_count, passed, notes, deficiency_observed, remedial_training_recommended, recorded_at").eq("department_id", id).eq("completed", true); }
  listRangeRoster(id: string) { return this.client.from("range_day_roster").select("id, range_day_id, officer_user_id, attendance_status").eq("department_id", id); }
}
