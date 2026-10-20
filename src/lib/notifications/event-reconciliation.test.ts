/* eslint-disable @typescript-eslint/no-explicit-any -- evaluator rows in the TRN-10 reproduction */
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

// TRN-10: the real evaluator on consecutive days, building the alert exactly
// as the generator does (reproduction: reconciliation evidence/trn10-fingerprint.mts).
test("readiness alerts keep one fingerprint, snooze and acknowledgement across days", async (t) => {
  const { evaluateCertificationReadiness } = await import("../tracepoint/certification-readiness.ts");
  const input = {
    members: [{ userId: "u-self", fullName: "Self" }],
    certificationTypes: [{ id: "cpr", name: "CPR", category: "Medical", expirationRequired: true, defaultDueSoonDays: 30 }],
    requirements: [{ certificationTypeId: "cpr", isRequired: true, isActive: true }],
    credentials: [{ id: "c1", userId: "u-self", certificationTypeId: "cpr", issueDate: "2024-10-01", expirationDate: "2026-10-10", isActive: true }],
  };
  const alert = (row: any) => ({ key: `certification-readiness-${row.userId}-${row.certificationTypeId}`, source: "Training",
    kind: `required_certification_${row.status}`, title: `${row.certificationName} Expired`, detail: row.statusReason,
    href: "/training/certifications", priority: "Critical", createdAt: row.expirationDate });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-20T15:00:00Z") });
  const day1 = alert(evaluateCertificationReadiness(input as any)[0]);
  t.mock.timers.setTime(new Date("2026-10-21T15:00:00Z").getTime());
  const day2 = alert(evaluateCertificationReadiness(input as any)[0]);
  assert.notEqual(day1.detail, day2.detail);
  const first = buildNotificationEventReconciliationRow({ departmentId: "d", userId: "u-self", item: day1, now: "2026-10-20T15:00:00Z" });
  const prior = { ...first.row, snoozed_until: "2026-10-25T00:00:00Z", acknowledged_at: "2026-10-20T16:00:00Z" };
  const second = buildNotificationEventReconciliationRow({ departmentId: "d", userId: "u-self", item: day2, prior, now: "2026-10-21T15:00:00Z" });
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(second.row.snoozed_until, "2026-10-25T00:00:00Z");
  assert.equal(second.row.acknowledged_at, "2026-10-20T16:00:00Z");
  assert.equal(second.row.detail, day2.detail);
  // A different condition (new kind, severity or condition date) still reopens.
  for (const change of [{ kind: "required_certification_due_soon", priority: "High" }, { createdAt: "2027-10-10" }]) {
    const changed = buildNotificationEventReconciliationRow({ departmentId: "d", userId: "u-self", item: { ...day2, ...change }, prior, now: "2026-10-21T15:00:00Z" });
    assert.notEqual(changed.fingerprint, first.fingerprint);
    assert.equal(changed.row.snoozed_until, null);
    assert.equal(changed.row.acknowledged_at, null);
  }
});

test("rows fingerprinted before the stable format keep their snooze and queued email", () => {
  const legacyItem = { ...item, detail: "Certification expired 10 days ago.", emailEnabled: true };
  const prior = { notification_key: item.key, fingerprint: JSON.stringify(legacyItem), first_seen_at: "2026-09-01T00:00:00Z", snoozed_until: "2026-09-10T00:00:00Z" };
  const same = buildNotificationEventReconciliationRow({ departmentId: "d", userId: "u", item: { ...item, detail: "Certification expired 11 days ago." }, prior, now: "2026-09-05T00:00:00Z" });
  // The stored fingerprint is kept, so the dispatcher still matches the queued row and nothing is re-queued.
  assert.equal(same.fingerprint, prior.fingerprint);
  assert.equal(same.row.snoozed_until, "2026-09-10T00:00:00Z");
  const changed = buildNotificationEventReconciliationRow({ departmentId: "d", userId: "u", item: { ...item, priority: "High" }, prior, now: "2026-09-05T00:00:00Z" });
  assert.equal(changed.fingerprint, notificationFingerprint({ ...item, priority: "High" }));
  assert.equal(changed.row.snoozed_until, null);
});
