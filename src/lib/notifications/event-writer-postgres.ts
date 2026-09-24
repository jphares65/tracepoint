import type { Pool } from "pg";
import type { NotificationEventWriteDataSource, NotificationWriteResult } from "./event-writer-core.ts";
import { SupabaseNotificationEventWriteDataSource, type NotificationWriteClient } from "./event-writer-supabase.ts";

export const enqueueSql = `select tracepoint_auth.enqueue_notification_email(
  $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,
  $8::timestamptz,$9::text,$10::timestamptz
) as accepted`;

export class PostgresNotificationEventWriteDataSource implements NotificationEventWriteDataSource {
  private readonly subjectWrites: SupabaseNotificationEventWriteDataSource;
  private readonly pool: Pick<Pool, "query">;

  constructor(client: NotificationWriteClient, pool: Pick<Pool, "query">) {
    this.subjectWrites = new SupabaseNotificationEventWriteDataSource(client);
    this.pool = pool;
  }

  upsertEvent(row: Record<string, unknown>) {
    return this.subjectWrites.upsertEvent(row);
  }

  resolveEvent(eventId: string, departmentId: string, userId: string, now: string) {
    return this.subjectWrites.resolveEvent(eventId, departmentId, userId, now);
  }

  async upsertEmail(row: Record<string, unknown>): Promise<NotificationWriteResult> {
    try {
      const result = await this.pool.query(enqueueSql, [
        row.department_id, row.user_id, row.recipient_email, row.notification_key,
        row.fingerprint, row.subject, row.body_text, row.scheduled_for,
        row.status, row.updated_at,
      ]);
      return result.rows[0]?.accepted === true
        ? { error: null }
        : { error: { message: "Notification enqueue was rejected." } };
    } catch {
      return { error: { message: "Notification enqueue was rejected." } };
    }
  }
}
