import {
  EquipmentReadRepositoryError,
  type EquipmentMemberRow,
  type EquipmentProfileRow,
  type EquipmentReadDataSource,
  type EquipmentRow,
} from "./read-repository-core.ts";

type ProviderResult<T> = { data: T | null; error: { message: string } | null };
export type EquipmentReadQuery = PromiseLike<ProviderResult<unknown>> & {
  select(fields: string): EquipmentReadQuery;
  eq(column: string, value: unknown): EquipmentReadQuery;
  in(column: string, values: string[]): EquipmentReadQuery;
  order(column: string, options?: { ascending?: boolean }): EquipmentReadQuery;
};
export type EquipmentReadSupabaseClient = { from(table: string): EquipmentReadQuery };

export class SupabaseEquipmentReadDataSource implements EquipmentReadDataSource {
  private readonly client: EquipmentReadSupabaseClient;

  constructor(client: EquipmentReadSupabaseClient) {
    this.client = client;
  }

  private result<T>(result: ProviderResult<unknown>, message: string): T {
    if (result.error) throw new EquipmentReadRepositoryError(message);
    return result.data as T;
  }

  async listTypes(departmentId: string) {
    const result = await this.client.from("equipment_types").select("*")
      .eq("department_id", departmentId).order("category").order("name");
    return this.result<EquipmentRow[]>(result, "Equipment types could not be loaded.") ?? [];
  }

  async listAssets(input: { departmentId: string; assignedUserId?: string }) {
    let query = this.client.from("equipment_assets").select("*")
      .eq("department_id", input.departmentId)
      .order("created_at", { ascending: false });
    if (input.assignedUserId) query = query.eq("assigned_user_id", input.assignedUserId);
    const result = await query;
    return this.result<EquipmentRow[]>(result, "Equipment assets could not be loaded.") ?? [];
  }

  async listActiveMembers(departmentId: string) {
    const result = await this.client.from("department_memberships")
      .select("user_id,badge_number,rank_title,unit_name,is_active")
      .eq("department_id", departmentId).eq("is_active", true);
    return this.result<EquipmentMemberRow[]>(result, "Equipment members could not be loaded.") ?? [];
  }

  async listProfiles(userIds: string[]) {
    const result = await this.client.from("profiles").select("id,full_name").in("id", userIds);
    return this.result<EquipmentProfileRow[]>(result, "Equipment member profiles could not be loaded.") ?? [];
  }

  async listRequirements(departmentId: string) {
    const result = await this.client.from("department_equipment_requirements").select("*")
      .eq("department_id", departmentId).order("created_at");
    return this.result<EquipmentRow[]>(result, "Equipment requirements could not be loaded.") ?? [];
  }
}
