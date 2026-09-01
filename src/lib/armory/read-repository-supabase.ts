import type { ArmoryReadDataSource, ArmoryResult, ArmoryUsersResult } from "./read-repository-core.ts";
export const INSPECTION_FIELDS = `
        *,
        firearm:firearms (
          id,
          make,
          model,
          serial_number,
          asset_number,
          condition_status
        ),
        items:firearm_inspection_items (
          id,
          section,
          label,
          status,
          note,
          critical,
          sort_order
        )
      `;
export type ArmoryQuery = PromiseLike<ArmoryResult> & { select(fields: string): ArmoryQuery; eq(column: string, value: unknown): ArmoryQuery; is(column: string, value: null): ArmoryQuery; in(column: string, values: string[]): ArmoryQuery; order(column: string, options?: { ascending: boolean }): ArmoryQuery; limit(value: number): ArmoryQuery };
export type ArmoryClient = { from(table: string): ArmoryQuery };
export type ArmoryAdmin = { auth: { admin: { listUsers(input: { page: number; perPage: number }): PromiseLike<ArmoryUsersResult> } } };
export class SupabaseArmoryReadDataSource implements ArmoryReadDataSource {
  private readonly db: ArmoryClient; private readonly admin: ArmoryAdmin;
  constructor(db: ArmoryClient, admin: ArmoryAdmin) { this.db = db; this.admin = admin; }
  listActiveAssignments(id: string, user?: string) { let query = this.db.from("firearm_assignments").select("id,firearm_id,assigned_to_user_id,assigned_at,magazines_issued,magazine_description,magazines_returned,magazine_discrepancy_reason").eq("department_id", id).is("returned_at", null); if (user) query = query.eq("assigned_to_user_id", user); return query; }
  listFirearms(id: string, input: { includeArchived: boolean; firearmIds?: string[] }) { let query = this.db.from("firearms").select("id,department_id,make,model,serial_number,firearm_type,caliber,asset_number,condition_status,notes,needs_attention,attention_reasons,is_active,archived_at,archived_by_user_id,archive_reason,created_at,updated_at").eq("department_id", id).order("make", { ascending: true }).order("model", { ascending: true }); if (!input.includeArchived) query = query.eq("is_active", true); if (input.firearmIds) query = query.in("id", input.firearmIds); return query; }
  listActiveMembers(id: string) { return this.db.from("department_memberships").select("user_id,rank_title,badge_number").eq("department_id", id).eq("is_active", true); }
  listProfiles(ids: string[]) { return this.db.from("profiles").select("id,full_name,email").in("id", ids); }
  listAuthUsers() { return this.admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); }
  listInspections(id: string) { return this.db.from("firearm_inspections").select(INSPECTION_FIELDS).eq("department_id", id).order("inspection_date", { ascending: false }).limit(100); }
}
