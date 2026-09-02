import "server-only";
import { requireTrainingReadProvider, TenantBoundTrainingReadRepository } from "./read-repository-core";
import { SupabaseTrainingReadDataSource, type TrainingClient } from "./read-repository-supabase";
export function createTrainingReadRepository(client: TrainingClient, departmentId: string) { requireTrainingReadProvider(process.env.TRACEPOINT_DATA_PROVIDER); return new TenantBoundTrainingReadRepository(new SupabaseTrainingReadDataSource(client), departmentId); }
