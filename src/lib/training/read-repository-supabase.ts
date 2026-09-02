import type { TrainingReadDataSource, TrainingResult } from "./read-repository-core.ts";
export type TrainingQuery = PromiseLike<TrainingResult> & { select(fields: string): TrainingQuery; eq(column: string, value: unknown): TrainingQuery; order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): TrainingQuery; in(column: string, values: string[]): TrainingQuery };
export type TrainingClient = { from(table: string): TrainingQuery };
export class SupabaseTrainingReadDataSource implements TrainingReadDataSource {
  private readonly client: TrainingClient;
  constructor(client: TrainingClient) { this.client = client; }
  listCertifications(id: string) { return this.client.from("training_certifications").select("*").eq("department_id", id).eq("is_active", true).order("expiration_date", { ascending: true, nullsFirst: false }); }
  listMemberships(id: string) { return this.client.from("department_memberships").select("user_id,badge_number,rank_title,is_active").eq("department_id", id).eq("is_active", true); }
  listTypes(id: string) { return this.client.from("certification_types").select("id,department_id,name,description,category,issuing_organization,expiration_required,default_valid_days,default_due_soon_days,is_active").eq("department_id", id).eq("is_active", true).order("category", { ascending: true }).order("name", { ascending: true }); }
  listRequirements(id: string, fields: string, order?: string) { const query = this.client.from("department_certification_requirements").select(fields).eq("department_id", id); return order ? query.order(order) : query.eq("is_active", true); }
  listProfiles(ids: string[]) { return this.client.from("profiles").select("id,full_name").in("id", ids); }
}
