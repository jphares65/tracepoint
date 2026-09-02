import "server-only";
import { requireRangeReadProvider, TenantBoundRangeReadRepository } from "./read-repository-core";
import { SupabaseRangeReadDataSource, type RangeClient } from "./read-repository-supabase";
export function createRangeReadRepository(client: RangeClient, id: string) { requireRangeReadProvider(process.env.TRACEPOINT_DATA_PROVIDER); return new TenantBoundRangeReadRepository(new SupabaseRangeReadDataSource(client), id); }
