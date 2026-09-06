import assert from "node:assert/strict";
import test from "node:test";

import {
  NotificationWriteAuthorizationError,
  NotificationWriteRepositoryError,
  TenantBoundNotificationEventWriter,
  type NotificationEventWriteDataSource,
} from "./event-writer-core.ts";
import {
  SupabaseNotificationEventWriteDataSource,
  type NotificationWriteClient,
  type NotificationWriteQuery,
} from "./event-writer-supabase.ts";

const source = (
  overrides: Partial<NotificationEventWriteDataSource> = {},
): NotificationEventWriteDataSource => ({
  upsertEvent: async () => ({ error: null }),
  upsertEmail: async () => ({ error: null }),
  resolveEvent: async () => ({ error: null }),
  ...overrides,
});

test("notification event writes require matching tenant and user", async () => {
  let calls = 0;
  const writer = new TenantBoundNotificationEventWriter(source({
    upsertEvent: async () => {
      calls += 1;
      return { error: null };
    },
  }), "d", "u");

  await assert.rejects(
    writer.upsertEvent({ department_id: "x", user_id: "u" }),
    NotificationWriteAuthorizationError,
  );
  await assert.rejects(
    writer.upsertEvent({ department_id: "d", user_id: "x" }),
    NotificationWriteAuthorizationError,
  );
  assert.equal(calls, 0);
  await writer.upsertEvent({ department_id: "d", user_id: "u" });
  assert.equal(calls, 1);
});

test("notification event writes preserve provider errors", async () => {
  const writer = new TenantBoundNotificationEventWriter(source({
    resolveEvent: async () => ({ error: { message: "failed" } }),
  }), "d", "u");
  await assert.rejects(
    writer.resolveEvent("n", "now"),
    NotificationWriteRepositoryError,
  );
});

test("notification resolution is constrained to its tenant and user", async () => {
  const calls: string[] = [];
  const target = {
    then(resolve: (value: { error: null }) => unknown) {
      return Promise.resolve(resolve({ error: null }));
    },
  } as unknown as PromiseLike<{ error: null }>;
  const query = new Proxy(target, {
    get(current, key) {
      if (key === "then") return current.then?.bind(current);
      return (...args: unknown[]) => {
        calls.push(`${String(key)}:${JSON.stringify(args)}`);
        return query;
      };
    },
  }) as NotificationWriteQuery;
  const adapter = new SupabaseNotificationEventWriteDataSource({
    from(table: string) {
      calls.push(`from:${table}`);
      return query;
    },
  } satisfies NotificationWriteClient);

  await adapter.upsertEvent({ id: "n" });
  await adapter.upsertEmail({ id: "e" });
  await adapter.resolveEvent("n", "department-a", "user-a", "now");

  assert.ok(calls.includes(
    'upsert:[{"id":"n"},{"onConflict":"department_id,user_id,notification_key"}]',
  ));
  assert.ok(calls.includes(
    'upsert:[{"id":"e"},{"onConflict":"department_id,user_id,notification_key,fingerprint","ignoreDuplicates":true}]',
  ));
  assert.ok(calls.includes('update:[{"resolved_at":"now","updated_at":"now"}]'));
  assert.ok(calls.includes('eq:["department_id","department-a"]'));
  assert.ok(calls.includes('eq:["user_id","user-a"]'));
});
