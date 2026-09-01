import "server-only";
import { requireArmoryReadProvider, TenantBoundArmoryReadRepository } from "./read-repository-core";
import { SupabaseArmoryReadDataSource, type ArmoryAdmin, type ArmoryClient } from "./read-repository-supabase";
export function createArmoryReadRepository(db: ArmoryClient, admin: ArmoryAdmin, departmentId: string, userId: string) {
  requireArmoryReadProvider(process.env.TRACEPOINT_DATA_PROVIDER);
  return new TenantBoundArmoryReadRepository(new SupabaseArmoryReadDataSource(db, admin), departmentId, userId);
}
