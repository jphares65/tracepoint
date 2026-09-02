import "server-only";
import { requireFleetReadProvider, TenantBoundFleetReadRepository } from "./read-repository-core";
import { SupabaseFleetReadDataSource, type FleetClient } from "./read-repository-supabase";
export function createFleetReadRepository(client: FleetClient, departmentId: string) { requireFleetReadProvider(process.env.TRACEPOINT_DATA_PROVIDER); return new TenantBoundFleetReadRepository(new SupabaseFleetReadDataSource(client), departmentId); }
