// TRN-05 + TRN-13: evaluate gate logic extracted verbatim from current source text.
import { readFileSync } from "node:fs";
const CUR = process.argv[2];
const route = readFileSync(`${CUR}/src/app/api/notifications/route.ts`, "utf8");
const home = readFileSync(`${CUR}/src/app/page.tsx`, "utf8");
// --- TRN-05: default preference + email-queue condition
const defaults = route.match(/critical_email_only:\s*data\?\.critical_email_only\s*\?\?\s*(true|false)/)![1];
const emailDefault = route.match(/email_enabled:\s*data\?\.email_enabled\s*\?\?\s*(true|false)/)?.[1];
const cond = route.match(/if \(\s*(preferences\.email_enabled[\s\S]*?notificationRecipientEmail)\s*\) \{\s*try \{ await eventWriter\.upsertEmail/)![1];
const gate = new Function("preferences", "item", "qualificationEmailReady", "notificationRecipientEmail", `return Boolean(${cond});`);
console.log(`default critical_email_only=${defaults}; default email_enabled=${emailDefault ?? "(not found)"}`);
const prefs = { email_enabled: true, critical_email_only: defaults === "true" };
for (const item of [
  { kind: "required_certification_due_soon", priority: "High", source: "Training" },
  { kind: "agency_training_due_soon (<=30d)", priority: "High", source: "Training" },
  { kind: "agency_training_due_soon (>30d)", priority: "Normal", source: "Training" },
  { kind: "required_certification_expired", priority: "Critical", source: "Training" },
]) console.log(`  ${item.kind.padEnd(36)} priority=${item.priority.padEnd(8)} email queued=${gate(prefs, item, true, "o@x.gov")}`);
// --- TRN-13: kinds the API refuses to acknowledge (409) vs kinds the home page hides Acknowledge for
const apiSet = [...route.match(/CONDITION_BASED_NOTIFICATION_KINDS = new Set\(\[([\s\S]*?)\]\)/)![1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
const homeSet = [...home.match(/function isConditionBasedReadiness[\s\S]*?return \[([\s\S]*?)\]\.includes/)![1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
const deadEnd = apiSet.filter(k => !homeSet.includes(k));
console.log(`TRN-13: API 409 kinds=${apiSet.length}, home hides Acknowledge for=${homeSet.length}; Acknowledge shown but rejected (409) for ${deadEnd.length}:`);
console.log("  " + deadEnd.join(", "));
