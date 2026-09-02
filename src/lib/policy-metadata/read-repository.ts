import "server-only";
import { requirePolicyReadProvider, TenantBoundPolicyReadRepository } from "./read-repository-core";
import { SupabasePolicyReadDataSource, type PolicyClient } from "./read-repository-supabase";
export function createPolicyReadRepository(client: PolicyClient, id: string) { requirePolicyReadProvider(process.env.TRACEPOINT_DATA_PROVIDER); return new TenantBoundPolicyReadRepository(new SupabasePolicyReadDataSource(client), id); }
