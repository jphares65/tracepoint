import "server-only";
import { requireArmoryReadProvider, TenantBoundArmoryReadRepository } from "./read-repository-core";
import { SupabaseArmoryReadDataSource, type ArmoryAdmin, type ArmoryClient } from "./read-repository-supabase";
import { PostgresArmoryReadDataSource } from "./read-repository-postgres";
export function createArmoryReadRepository(db: ArmoryClient, admin: ArmoryAdmin, departmentId: string, userId: string) {
  const provider = requireArmoryReadProvider(process.env.TRACEPOINT_DATA_PROVIDER);
  return new TenantBoundArmoryReadRepository(provider === "postgres" ? new PostgresArmoryReadDataSource(db) : new SupabaseArmoryReadDataSource(db, admin), departmentId, userId);
}
