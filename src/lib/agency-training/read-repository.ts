import "server-only";
import { requireAgencyTrainingReadProvider, TenantBoundAgencyTrainingReadRepository } from "./read-repository-core";
import { SupabaseAgencyTrainingReadDataSource, type AgencyTrainingClient } from "./read-repository-supabase";

export function createAgencyTrainingReadRepository(client: AgencyTrainingClient, departmentId: string) {
  requireAgencyTrainingReadProvider(process.env.TRACEPOINT_DATA_PROVIDER);
  return new TenantBoundAgencyTrainingReadRepository(new SupabaseAgencyTrainingReadDataSource(client), departmentId);
}
