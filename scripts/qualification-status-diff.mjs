// Before/after qualification status for every active officer in a snapshot from
// scripts/qualification-status-snapshot.sql. "Before" is the readiness module at
// a git ref, "after" is the module in this checkout; both are evaluated the way
// the performance summary and Command Dashboard evaluate them. Read-only.
//   node --import tsx scripts/qualification-status-diff.mjs snapshot.json --before <git-ref> [--json]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const snapshotPath = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--before");
const before = args[args.indexOf("--before") + 1];
if (!snapshotPath || !args.includes("--before") || !before) {
  console.error("usage: node --import tsx scripts/qualification-status-diff.mjs <snapshot.json> --before <git-ref> [--json]");
  process.exit(2);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const modulePath = "src/lib/tracepoint/qualification-readiness.ts";
const directory = mkdtempSync(path.join(tmpdir(), "qualification-status-diff-"));
try {
  writeFileSync(path.join(directory, "qualification-readiness.ts"), execFileSync("git", ["show", `${before}:${modulePath}`], { cwd: root }));
  const previous = await import(pathToFileURL(path.join(directory, "qualification-readiness.ts")).href);
  const current = await import(pathToFileURL(path.join(root, modulePath)).href);
  const { mapCurrentRules } = await import(pathToFileURL(path.join(root, "src/lib/department-rules/current-rules-repository-core.ts")).href);

  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8").replace(/^﻿/, ""));
  const report = (snapshot.departments ?? []).map((agency) => {
    const rules = mapCurrentRules(agency.rules ?? null);
    const workspace = agency.workspace ?? {};
    const days = new Map((workspace.rangeDays ?? []).map((day) => [day.id, day]));
    const drills = new Map((workspace.rangeDayDrills ?? []).map((drill) => [drill.id, drill]));
    const evaluate = (module, userId) => module.evaluateCanonicalQualificationReadiness({
      workspace,
      qualificationResults: agency.qualificationResults ?? [],
      qualificationStandards: agency.qualificationStandards ?? [],
      officerId: userId,
      officerUserId: userId,
      scope: { requiredComponents: rules.required_handgun_qualification_components },
      qualificationValidDays: rules.qualification_valid_days,
      qualificationDueSoonDays: rules.qualification_due_soon_days,
    });
    const officers = (agency.personnel ?? []).map((person) => {
      const was = evaluate(previous, person.userId);
      const now = evaluate(current, person.userId);
      // Indicators of which B10 rule touches this officer's records.
      const own = (workspace.results ?? []).filter((result) => result.officerId === person.userId);
      const notes = [];
      const openDay = own.filter((result) => !["completed", "locked", "archived"].includes(String(days.get(result.rangeDayId)?.status ?? "").toLowerCase())).length;
      if (openDay) notes.push(`${openDay} result(s) on days not closed (RNG-24)`);
      const anyFirearm = own.filter((result) => String(drills.get(result.drillId)?.firearmType ?? "").toLowerCase() === "any").length;
      if (anyFirearm) notes.push(`${anyFirearm} result(s) on "Any" firearm drills (RNG-09)`);
      return { userId: person.userId, name: person.name, before: was.status, after: now.status, afterReason: now.statusReason, notes };
    });
    const counts = (key) => officers.reduce((all, officer) => ({ ...all, [officer[key]]: (all[officer[key]] ?? 0) + 1 }), {});
    return {
      departmentId: agency.departmentId,
      name: agency.name,
      officers: officers.length,
      before: counts("before"),
      after: counts("after"),
      changed: officers.filter((officer) => officer.before !== officer.after),
    };
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify({ generatedAt: snapshot.generatedAt, before, agencies: report }, null, 2));
  } else {
    for (const agency of report) {
      console.log(`\n${agency.name} (${agency.departmentId}): ${agency.officers} active members, ${agency.changed.length} status change(s)`);
      console.log(`  before: ${JSON.stringify(agency.before)}`);
      console.log(`  after:  ${JSON.stringify(agency.after)}`);
      for (const officer of agency.changed) {
        console.log(`  - ${officer.name}: ${officer.before} -> ${officer.after}. ${officer.afterReason}${officer.notes.length ? ` [${officer.notes.join("; ")}]` : ""}`);
      }
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
