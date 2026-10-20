import type { ArmoryReadDataSource, ArmoryResult, ArmoryRow, ArmoryUsersResult } from "./read-repository-core";
import { SupabaseArmoryReadDataSource, type ArmoryClient } from "./read-repository-supabase";

export type ArmoryRpcClient = ArmoryClient & { rpc(name: string, args: Record<string, unknown>): PromiseLike<ArmoryResult> };

// Adds rows from the armory identity lookup that the direct read did not return.
function merge(result: ArmoryResult, extra: ArmoryResult, key: string, map: (row: ArmoryRow) => ArmoryRow): ArmoryResult {
  if (result.error) return result;
  if (extra.error) return { data: null, error: extra.error };
  const rows = [...(result.data ?? [])];
  const seen = new Set(rows.map((row) => String(row[key])));
  for (const row of extra.data ?? []) if (!seen.has(String(row.user_id))) rows.push(map(row));
  return { data: rows, error: null };
}

// The data queries share the existing Supabase-shaped PostgresDataClient API.
// The user directory does not: Cognito users are represented by RDS profiles.
// Under AWS RLS only user administrators read others' profiles and
// memberships, so the names the armory shows come from
// armory_member_identities (053), which returns only those fields.
export class PostgresArmoryReadDataSource implements ArmoryReadDataSource {
  private readonly data: SupabaseArmoryReadDataSource;
  private identities: Promise<ArmoryResult> | null = null;
  constructor(private readonly client: ArmoryRpcClient) {
    this.data = new SupabaseArmoryReadDataSource(client, {
      auth: { admin: { listUsers: () => { throw new Error("Supabase Auth is unavailable in AWS-native mode."); } } },
    });
  }
  private memberIdentities(departmentId: string) {
    this.identities ??= Promise.resolve(this.client.rpc("armory_member_identities", { p_department_id: departmentId }));
    return this.identities;
  }
  listActiveAssignments(departmentId: string, userId?: string) { return this.data.listActiveAssignments(departmentId, userId); }
  listFirearms(departmentId: string, input: { includeArchived: boolean; firearmIds?: string[] }) { return this.data.listFirearms(departmentId, input); }
  async listActiveMembers(departmentId: string) {
    const [direct, identities] = await Promise.all([this.data.listActiveMembers(departmentId), this.memberIdentities(departmentId)]);
    const active = identities.error ? identities : { data: (identities.data ?? []).filter((row) => row.is_active === true), error: null };
    return merge(direct, active, "user_id", ({ user_id, rank_title, badge_number, unit_name }) => ({ user_id, rank_title, badge_number, unit_name }));
  }
  async listInactiveMembers(departmentId: string, userIds: string[]) {
    const [direct, identities] = await Promise.all([this.data.listInactiveMembers(departmentId, userIds), this.memberIdentities(departmentId)]);
    const inactive = identities.error ? identities : { data: (identities.data ?? []).filter((row) => row.is_active === false && userIds.includes(String(row.user_id))), error: null };
    return merge(direct, inactive, "user_id", ({ user_id, rank_title, badge_number, unit_name }) => ({ user_id, rank_title, badge_number, unit_name }));
  }
  // Called after the member lists, which load the identities.
  async listProfiles(userIds: string[]) {
    const direct = await this.data.listProfiles(userIds);
    if (!this.identities) return direct;
    const identities = await this.identities;
    const named = identities.error ? identities : { data: (identities.data ?? []).filter((row) => userIds.includes(String(row.user_id))), error: null };
    return merge(direct, named, "id", ({ user_id, full_name }) => ({ id: user_id, full_name, email: null }));
  }
  listInspections(departmentId: string) { return this.data.listInspections(departmentId); }
  async listAuthUsers(userIds: string[]): Promise<ArmoryUsersResult> {
    if (!userIds.length) return { data: { users: [] }, error: null };
    const result = await this.client.from("profiles").select("id,email,full_name").in("id", userIds);
    return result.error
      ? { data: null, error: result.error }
      : { data: { users: (result.data ?? []).map((row) => ({
        id: row.id, email: row.email, user_metadata: { full_name: row.full_name },
      })) }, error: null };
  }
}
