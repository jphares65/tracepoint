import type { ReadinessDataSource, ReadinessResult } from "./read-repository-core.ts";
export type ReadinessQuery = PromiseLike<ReadinessResult> & { select(fields: string): ReadinessQuery; eq(column: string, value: unknown): ReadinessQuery; neq(column: string, value: unknown): ReadinessQuery; in(column: string, values: string[]): ReadinessQuery };
export type ReadinessClient = { from(table: string): ReadinessQuery };
export class SupabaseReadinessDataSource implements ReadinessDataSource {
  private readonly client: ReadinessClient;
  constructor(client: ReadinessClient) { this.client = client; }
  listEquipmentMembers(id: string, user?: string) { let q = this.client.from("department_memberships").select("user_id,badge_number,rank_title,unit_name,is_active").eq("department_id", id).eq("is_active", true); if (user) q = q.eq("user_id", user); return q; }
  listEquipmentTypes(id: string) { return this.client.from("equipment_types").select("id,name,category,expiration_required,default_valid_days,default_due_soon_days,inspection_required,default_inspection_interval_days,default_inspection_due_soon_days,is_active").eq("department_id", id).eq("is_active", true); }
  listEquipmentRequirements(id: string) { return this.client.from("department_equipment_requirements").select("equipment_type_id,is_required,required_quantity,scope_type,scope_value,affects_readiness,valid_days,due_soon_days,inspection_interval_days,inspection_due_soon_days,is_active").eq("department_id", id).eq("is_active", true).eq("is_required", true); }
  listEquipmentAssets(id: string, user?: string) { let q = this.client.from("equipment_assets").select("id,equipment_type_id,assigned_user_id,manufacturer,model,serial_number,lot_number,issue_date,expiration_date,last_inspection_date,next_inspection_date,lifecycle_status").eq("department_id", id).neq("lifecycle_status", "removed"); if (user) q = q.eq("assigned_user_id", user); return q; }
  listCertificationMembers(id: string) { return this.client.from("department_memberships").select("user_id,badge_number,rank_title,is_active").eq("department_id", id).eq("is_active", true); }
  listCertificationTypes(id: string) { return this.client.from("certification_types").select("id,name,category,expiration_required,default_valid_days,default_due_soon_days,is_active").eq("department_id", id).eq("is_active", true); }
  listCertificationRequirements(id: string) { return this.client.from("department_certification_requirements").select("certification_type_id,is_required,is_active,valid_days,due_soon_days").eq("department_id", id).eq("is_active", true); }
  listCertificationCredentials(id: string) { return this.client.from("training_certifications").select("id,user_id,certification_type_id,issue_date,expiration_date,is_active").eq("department_id", id).eq("is_active", true); }
  listProfiles(ids: string[]) { return this.client.from("profiles").select("id,full_name").in("id", ids); }
}
