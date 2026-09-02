import "server-only";
import { requireNotificationReadProvider, TenantBoundNotificationReadRepository } from "./read-repository-core";
import { SupabaseNotificationReadDataSource, type NotificationClient } from "./read-repository-supabase";
export function createNotificationReadRepository(client: NotificationClient, departmentId: string, userId: string) { requireNotificationReadProvider(process.env.TRACEPOINT_DATA_PROVIDER); return new TenantBoundNotificationReadRepository(new SupabaseNotificationReadDataSource(client), departmentId, userId); }
