import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotificationEventReconciliationRow,
  notificationEventShouldResolve,
  notificationFingerprint,
} from "./event-reconciliation.ts";

const item = {
  key: "qualification-readiness-officer-a-handgun",
  source: "Qualifications",
  kind: "qualification_missing_night",
  title: "Night Qualification Missing",
  detail: "The required night component is missing.",
  href: "/qualifications",
  priority: "Critical",
  createdAt: "2026-09-01",
};

test("notification reconciliation deduplicates and preserves first-seen audit evidence", () => {
  const fingerprint = notificationFingerprint(item);
  const result = buildNotificationEventReconciliationRow({
    departmentId: "department-a",
    userId: "officer-a",
    item,
    prior: {
      notification_key: item.key,
      fingerprint,
      first_seen_at: "2026-09-01T00:00:00Z",
      acknowledged_at: "2026-09-02T00:00:00Z",
      snoozed_until: "2026-09-10T00:00:00Z",
    },
    now: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.row.notification_key, item.key);
  assert.equal(result.row.first_seen_at, "2026-09-01T00:00:00Z");
  assert.equal(result.row.acknowledged_at, "2026-09-02T00:00:00Z");
  assert.equal(result.row.resolved_at, null);
});

test("a changed or previously resolved condition reopens the same event key", () => {
  const result = buildNotificationEventReconciliationRow({
    departmentId: "department-a",
    userId: "officer-a",
    item,
    prior: {
      notification_key: item.key,
      fingerprint: "old-condition",
      first_seen_at: "2026-08-01T00:00:00Z",
      acknowledged_at: "2026-08-02T00:00:00Z",
      resolved_at: "2026-08-03T00:00:00Z",
    },
    now: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.row.first_seen_at, "2026-08-01T00:00:00Z");
  assert.equal(result.row.resolved_at, null);
  assert.equal(result.row.acknowledged_at, null);
});

test("only absent events from a successfully evaluated source resolve", () => {
  const successfulSources = new Set(["Qualifications"]);
  const activeKeys = new Set<string>();
  assert.equal(notificationEventShouldResolve({
    event: {
      notification_key: item.key,
      source: "Qualifications",
      resolved_at: null,
    },
    successfulSources,
    activeKeys,
  }), true);
  assert.equal(notificationEventShouldResolve({
    event: {
      notification_key: item.key,
      source: "Qualifications",
      resolved_at: "2026-09-05T00:00:00Z",
    },
    successfulSources,
    activeKeys,
  }), false);
  assert.equal(notificationEventShouldResolve({
    event: {
      notification_key: item.key,
      source: "Unavailable Source",
      resolved_at: null,
    },
    successfulSources,
    activeKeys,
  }), false);
});
