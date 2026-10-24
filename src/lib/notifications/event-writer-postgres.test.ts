import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TenantBoundNotificationEventWriter, NotificationWriteAuthorizationError } from "./event-writer-core.ts";
import { PostgresNotificationEventWriteDataSource, enqueueRefusalLogEntry, enqueueSql } from "./event-writer-postgres.ts";
import type { NotificationWriteClient, NotificationWriteQuery } from "./event-writer-supabase.ts";

const department = "20000000-0000-4000-8000-000000000001";
const user = "10000000-0000-4000-8000-000000000001";
const row = { department_id: department, user_id: user, recipient_email: "test@example.invalid",
  notification_key: "test", fingerprint: "sha256", subject: "Subject", body_text: "Body",
  scheduled_for: "2026-09-24T12:00:00Z", status: "Pending", updated_at: "2026-09-24T12:00:00Z" };

function fixture() {
  const tables: string[] = [];
  const queries: { sql: string; values: unknown[] }[] = [];
  const query = { then: (callback: (result: { error: null }) => unknown) => Promise.resolve(callback({ error: null })),
    upsert: () => query, update: () => query, eq: () => query } as NotificationWriteQuery;
  const client = { from(table: string) { tables.push(table); return query; } } satisfies NotificationWriteClient;
  const pool = { async query(sql: string, values: unknown[]) {
    queries.push({ sql, values }); return { rows: [{ accepted: true }] };
  } };
  const source = new PostgresNotificationEventWriteDataSource(client, pool as never);
  return { writer: new TenantBoundNotificationEventWriter(source, department, user), tables, queries };
}

test("native enqueue uses only fixed server-only function and preserves subject-bound event writes", async () => {
  const value = fixture();
  await value.writer.upsertEvent({ department_id: department, user_id: user });
  await value.writer.upsertEmail(row);
  assert.deepEqual(value.tables, ["notification_events"]);
  assert.equal(value.queries.length, 1);
  assert.equal(value.queries[0].sql, enqueueSql);
  assert.deepEqual(value.queries[0].values, Object.values(row));
  assert.doesNotMatch(enqueueSql, /insert\s+into|update\s+|delete\s+from/i);
});

test("cross-tenant and cross-user queue payloads cannot reach the privileged connection", async () => {
  const value = fixture();
  await assert.rejects(value.writer.upsertEmail({ ...row, department_id: user }), NotificationWriteAuthorizationError);
  await assert.rejects(value.writer.upsertEmail({ ...row, user_id: department }), NotificationWriteAuthorizationError);
  assert.equal(value.queries.length, 0);
});

test("schema grants function execution only to runtime and never direct queue insert to authenticated", () => {
  const sql = readFileSync(new URL("../../../database/aws/024_notification_email_server_enqueue.sql", import.meta.url), "utf8");
  assert.match(sql, /security definer/i);
  assert.match(sql, /session_user <> 'tracepoint_runtime'/i);
  assert.match(sql, /m\.is_active = true/i);
  assert.match(sql, /m\.department_id = p_department_id and m\.user_id = p_user_id/i);
  assert.match(sql, /lower\(btrim\(p\.email\)\) = lower\(btrim\(p_recipient_email\)\)/i);
  assert.match(sql, /e\.notification_key = p_notification_key\s+and e\.fingerprint = p_fingerprint/i);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function[\s\S]+to tracepoint_runtime/i);
  assert.doesNotMatch(sql, /grant\s+insert\s+on\s+(?:table\s+)?public\.notification_email_queue\s+to\s+authenticated/i);
});

test("AT-3b: a refused enqueue logs its SQLSTATE and stage, never the recipient, subject, body or database message", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => { logged.push(line); };
  try {
    for (const [failure, expected] of [
      [{ code: "42883", message: "function tracepoint_auth.enqueue_notification_email does not exist" }, { stage: "database_error", sqlstate: "42883" }],
      [{ code: "42501", message: "notification enqueue rejected" }, { stage: "database_error", sqlstate: "42501" }],
      [{ code: "not a sqlstate; test@example.invalid" }, { stage: "database_error", sqlstate: null }],
    ] as const) {
      const pool = { async query() { throw Object.assign(new Error(failure.message ?? "x"), { code: failure.code }); } };
      const source = new PostgresNotificationEventWriteDataSource({ from() { throw new Error("unused"); } } as never, pool as never);
      assert.deepEqual(await source.upsertEmail(row), { error: { message: "Notification enqueue was rejected." } });
      assert.deepEqual(JSON.parse(logged.at(-1)!), { event: "notification_email_enqueue_refused", ...expected });
    }
    const notAccepted = new PostgresNotificationEventWriteDataSource({ from() { throw new Error("unused"); } } as never, { async query() { return { rows: [{ accepted: false }] }; } } as never);
    await notAccepted.upsertEmail(row);
    assert.deepEqual(JSON.parse(logged.at(-1)!), { event: "notification_email_enqueue_refused", stage: "not_accepted", sqlstate: null });
  } finally { console.error = original; }
  for (const line of logged) for (const secret of [row.recipient_email, row.subject, row.body_text, "does not exist", "enqueue rejected"]) assert.doesNotMatch(line, new RegExp(secret));
  assert.deepEqual(enqueueRefusalLogEntry("database_error", null), { event: "notification_email_enqueue_refused", stage: "database_error", sqlstate: null });
});
