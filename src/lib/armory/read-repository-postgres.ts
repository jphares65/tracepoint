import type { ArmoryReadDataSource, ArmoryUsersResult } from "./read-repository-core";
import { SupabaseArmoryReadDataSource, type ArmoryClient } from "./read-repository-supabase";

// The data queries share the existing Supabase-shaped PostgresDataClient API.
// The user directory does not: Cognito users are represented by RDS profiles.
export class PostgresArmoryReadDataSource implements ArmoryReadDataSource {
  private readonly data: SupabaseArmoryReadDataSource;
  constructor(private readonly client: ArmoryClient) {
    this.data = new SupabaseArmoryReadDataSource(client, {
      auth: { admin: { listUsers: () => { throw new Error("Supabase Auth is unavailable in AWS-native mode."); } } },
    });
  }
  listActiveAssignments(departmentId: string, userId?: string) { return this.data.listActiveAssignments(departmentId, userId); }
  listFirearms(departmentId: string, input: { includeArchived: boolean; firearmIds?: string[] }) { return this.data.listFirearms(departmentId, input); }
  listActiveMembers(departmentId: string) { return this.data.listActiveMembers(departmentId); }
  listProfiles(userIds: string[]) { return this.data.listProfiles(userIds); }
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
