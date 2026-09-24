import "server-only";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { TenantBoundNotificationEventWriter } from "./event-writer-core";
import { PostgresNotificationEventWriteDataSource } from "./event-writer-postgres";
import { SupabaseNotificationEventWriteDataSource, type NotificationWriteClient } from "./event-writer-supabase";

export function createNotificationEventWriter(client: NotificationWriteClient, departmentId: string, userId: string) {
  const source = process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native"
    ? new PostgresNotificationEventWriteDataSource(client, getPostgresPool())
    : new SupabaseNotificationEventWriteDataSource(client);
  return new TenantBoundNotificationEventWriter(source, departmentId, userId);
}
