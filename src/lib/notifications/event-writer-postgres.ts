import type { Pool } from "pg";
import type { NotificationEventWriteDataSource, NotificationWriteResult } from "./event-writer-core.ts";
import { SupabaseNotificationEventWriteDataSource, type NotificationWriteClient } from "./event-writer-supabase.ts";

export const enqueueSql = `select tracepoint_auth.enqueue_notification_email(
  $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,
  $8::timestamptz,$9::text,$10::timestamptz
) as accepted`;

// AT-3b: a refused enqueue kept no cause. The SQLSTATE and a fixed stage are logged; the recipient, subject, body and
// database message are not (they may carry personal data). 42883 means the function is missing (SCH-1), 42501 a refusal
// by 024's checks.
export function enqueueRefusalLogEntry(stage: "not_accepted" | "database_error", error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return { event: "notification_email_enqueue_refused", stage, sqlstate: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null };
}

function logEnqueueRefusal(stage: "not_accepted" | "database_error", error: unknown) {
  console.error(JSON.stringify(enqueueRefusalLogEntry(stage, error)));
}

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
      if (result.rows[0]?.accepted === true) return { error: null };
      logEnqueueRefusal("not_accepted", null);
      return { error: { message: "Notification enqueue was rejected." } };
    } catch (error) {
      logEnqueueRefusal("database_error", error);
      return { error: { message: "Notification enqueue was rejected." } };
    }
  }
}
