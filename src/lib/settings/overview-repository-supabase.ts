import type { SettingsOverviewDataSource, SettingsResult, SettingsRow } from "./overview-repository-core.ts";

export type SettingsQuery = PromiseLike<SettingsResult<unknown>> & {
  select(fields: string): SettingsQuery; eq(column: string, value: unknown): SettingsQuery;
  in(column: string, values: string[]): SettingsQuery; order(column: string): SettingsQuery;
  single(): PromiseLike<SettingsResult<unknown>>; maybeSingle(): PromiseLike<SettingsResult<unknown>>;
};
export type SettingsClient = { from(table: string): SettingsQuery };

export class SupabaseSettingsOverviewDataSource implements SettingsOverviewDataSource {
  private readonly db: SettingsClient;
  private readonly admin: SettingsClient;
  constructor(db: SettingsClient, admin: SettingsClient) { this.db = db; this.admin = admin; }
  getDepartment(id: string) { return this.db.from("departments").select("id,name,short_name,state,county,agency_type,sworn_officers,civilian_staff,timezone,primary_contact_user_id,patch_url,accent_color,login_theme").eq("id", id).single() as PromiseLike<SettingsResult<SettingsRow>>; }
  getRules(id: string) { return this.db.from("department_rules").select("*").eq("department_id", id).maybeSingle() as PromiseLike<SettingsResult<SettingsRow>>; }
  getSecurity(id: string) { return this.db.from("department_security_settings").select("*").eq("department_id", id).maybeSingle() as PromiseLike<SettingsResult<SettingsRow>>; }
  listRoles() { return this.admin.from("roles").select("code,display_name,description,sort_order").order("sort_order") as PromiseLike<SettingsResult<SettingsRow[]>>; }
  listPermissions() { return this.admin.from("permissions").select("code,display_name,description") as PromiseLike<SettingsResult<SettingsRow[]>>; }
  listRolePermissions(id: string) { return this.db.from("department_role_permissions").select("role_code,permission_code").eq("department_id", id) as PromiseLike<SettingsResult<SettingsRow[]>>; }
  listMemberships(id: string) { return this.admin.from("department_memberships").select("user_id,badge_number,rank_title,unit_name,employee_number,is_active,joined_at,activation_status").eq("department_id", id) as PromiseLike<SettingsResult<SettingsRow[]>>; }
  listMembershipRoles(id: string) { return this.admin.from("department_membership_roles").select("user_id,role_code").eq("department_id", id) as PromiseLike<SettingsResult<SettingsRow[]>>; }
  listDepartmentRolePermissions(id: string) { return this.admin.from("department_role_permissions").select("role_code,permission_code").eq("department_id", id) as PromiseLike<SettingsResult<SettingsRow[]>>; }
  listProfiles(ids: string[]) { return this.admin.from("profiles").select("id,full_name,email").in("id", ids) as PromiseLike<SettingsResult<SettingsRow[]>>; }
}
