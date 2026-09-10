import "server-only";
import { requireArmoryReadProvider, TenantBoundArmoryReadRepository } from "./read-repository-core";
import { SupabaseArmoryReadDataSource, type ArmoryClient } from "./read-repository-supabase";
export function createArmoryReadRepository(db: ArmoryClient, _admin: unknown, departmentId: string, userId: string) {
  requireArmoryReadProvider(process.env.TRACEPOINT_DATA_PROVIDER);
  return new TenantBoundArmoryReadRepository(new SupabaseArmoryReadDataSource(db), departmentId, userId);
}
