import "server-only";
import { requireReadinessProvider, TenantBoundReadinessRepository } from "./read-repository-core";
import { SupabaseReadinessDataSource, type ReadinessClient } from "./read-repository-supabase";
export function createReadinessRepository(client: ReadinessClient, departmentId: string, environment?: { TRACEPOINT_DATA_PROVIDER?: string }) {
  requireReadinessProvider(environment ? environment.TRACEPOINT_DATA_PROVIDER : process.env.TRACEPOINT_DATA_PROVIDER);
  return new TenantBoundReadinessRepository(new SupabaseReadinessDataSource(client), departmentId);
}
