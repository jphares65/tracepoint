import "server-only";
import { requireNotificationReadProvider, TenantBoundNotificationReadRepository } from "./read-repository-core";
import { NotificationQueryReadDataSource, type NotificationClient } from "./read-repository-query";
export function createNotificationReadRepository(client: NotificationClient, departmentId: string, userId: string) { requireNotificationReadProvider(process.env.TRACEPOINT_DATA_PROVIDER); return new TenantBoundNotificationReadRepository(new NotificationQueryReadDataSource(client), departmentId, userId); }
