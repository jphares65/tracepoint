// TRN-10 isolated reproduction: evaluate readiness on two consecutive days
// with the real evaluator + reconciliation from the current worktree.
const CUR = process.argv[2];
const { evaluateCertificationReadiness } = await import(`${CUR}/src/lib/tracepoint/certification-readiness.ts`);
const { buildNotificationEventReconciliationRow } = await import(`${CUR}/src/lib/notifications/event-reconciliation.ts`);
const RealDate = Date;
function at(iso: string, fn: () => any) {
  const fixed = new RealDate(iso).getTime();
  // @ts-ignore
  globalThis.Date = class extends RealDate { constructor(...a: any[]) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  try { return fn(); } finally { globalThis.Date = RealDate; }
}
const input = {
  members: [{ userId: "u-self", fullName: "Self" }, { userId: "u-other", fullName: "Other" }],
  certificationTypes: [{ id: "cpr", name: "CPR", category: "Medical", expirationRequired: true, defaultDueSoonDays: 30 }],
  requirements: [{ certificationTypeId: "cpr", isRequired: true, isActive: true }],
  credentials: [
    { id: "c1", userId: "u-self", certificationTypeId: "cpr", issueDate: "2024-10-01", expirationDate: "2026-10-10", isActive: true },
    { id: "c2", userId: "u-other", certificationTypeId: "cpr", issueDate: "2024-11-01", expirationDate: "2026-11-05", isActive: true },
  ],
};
// Same alert shape the GET route builds for an expired row (route.ts:483-492)
const toAlert = (row: any) => ({ key: `certification-readiness-${row.userId}-${row.certificationTypeId}`, source: "Training",
  kind: `required_certification_${row.status}`, title: `${row.certificationName} ${row.status === "expired" ? "Expired" : "Due Soon"}`,
  detail: row.statusReason, href: "/training/certifications", priority: row.status === "expired" ? "Critical" : "High", createdAt: row.expirationDate });
let prior: any;
for (const day of ["2026-10-20T15:00:00Z", "2026-10-21T15:00:00Z"]) {
  const rows = at(day, () => evaluateCertificationReadiness(input));
  for (const r of rows) console.log(`${day.slice(0,10)} ${r.userId} status=${r.status} days=${r.daysRemaining} reason="${r.statusReason}"`);
  const self = rows.find((r: any) => r.userId === "u-self");
  const rec = buildNotificationEventReconciliationRow({ departmentId: "d", userId: "u-self", item: toAlert(self), prior, now: day });
  console.log(`  fingerprint changed vs prior: ${prior ? prior.fingerprint !== rec.fingerprint : "n/a"}; snoozed_until carried: ${rec.row.snoozed_until}`);
  prior = { ...rec.row, snoozed_until: "2026-10-22T00:00:00Z", acknowledged_at: null }; // user snoozes after day 1
}
