import "server-only";
import { requireSettingsOverviewProvider, TenantBoundSettingsOverviewRepository } from "./overview-repository-core";
import { SupabaseSettingsOverviewDataSource, type SettingsClient } from "./overview-repository-supabase";

export function createSettingsOverviewRepository(db: SettingsClient, admin: SettingsClient, departmentId: string, environment?: { TRACEPOINT_DATA_PROVIDER?: string }) {
  requireSettingsOverviewProvider(environment ? environment.TRACEPOINT_DATA_PROVIDER : process.env.TRACEPOINT_DATA_PROVIDER);
  return new TenantBoundSettingsOverviewRepository(new SupabaseSettingsOverviewDataSource(db, admin), departmentId);
}
