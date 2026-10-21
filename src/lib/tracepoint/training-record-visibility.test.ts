import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { authorizeRangeWorkspaceMutation } from "../range/workspace-mutation.ts";
import { TenantBoundAgencyTrainingReadRepository, type AgencyTrainingReadDataSource, type AgencyTrainingResult } from "../agency-training/read-repository-core.ts";
import { TenantBoundEvidenceReadRepository, type EvidenceReadDataSource } from "../evidence/read-repository-core.ts";
import { TRACEPOINT_PERMISSIONS } from "./permissions.ts";
import {
  AGENCY_TRAINING_RECORD_PERMISSIONS,
  AGENCY_TRAINING_SUMMARY_PERMISSIONS,
  CERTIFICATION_RECORD_PERMISSIONS,
  CERTIFICATION_SUMMARY_PERMISSIONS,
  QUALIFICATION_EVIDENCE_PERMISSIONS,
  RANGE_RECORD_PERMISSIONS,
  canViewDepartmentRecords,
  ownRangeWorkspace,
  ownRows,
} from "./training-record-visibility.ts";

// TRN-26 / RNG-28. Route modules cannot be imported under node:test, so the
// filters are tested here and the routes' use of them is guarded in source.
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("the permission mapping: own records for everyone, department records only within a responsibility", () => {
  const view = (permission: string) => ({
    certifications: canViewDepartmentRecords([permission], CERTIFICATION_RECORD_PERMISSIONS),
    certificationSummary: canViewDepartmentRecords([permission], CERTIFICATION_SUMMARY_PERMISSIONS),
    agencyTraining: canViewDepartmentRecords([permission], AGENCY_TRAINING_RECORD_PERMISSIONS),
    agencyTrainingSummary: canViewDepartmentRecords([permission], AGENCY_TRAINING_SUMMARY_PERMISSIONS),
    range: canViewDepartmentRecords([permission], RANGE_RECORD_PERMISSIONS),
    evidence: canViewDepartmentRecords([permission], QUALIFICATION_EVIDENCE_PERMISSIONS),
  });
  const none = { certifications: false, certificationSummary: false, agencyTraining: false, agencyTrainingSummary: false, range: false, evidence: false };
  assert.deepEqual(view("administer_department"), { certifications: true, certificationSummary: true, agencyTraining: true, agencyTrainingSummary: true, range: true, evidence: true });
  assert.deepEqual(view("manage_certifications"), { ...none, certifications: true, certificationSummary: true });
  assert.deepEqual(view("manage_training"), { ...none, agencyTraining: true, agencyTrainingSummary: true, range: true });
  assert.deepEqual(view("manage_qualifications"), { ...none, range: true, evidence: true });
  assert.deepEqual(view("manage_range_days"), { ...none, range: true, evidence: true });
  assert.deepEqual(view("score_range_days"), { ...none, range: true, evidence: true });
  assert.deepEqual(view("view_command_dashboard"), { ...none, certificationSummary: true, agencyTrainingSummary: true, range: true });
  assert.deepEqual(view("view_analytics"), { ...none, certificationSummary: true, range: true, evidence: true });
  for (const permission of ["manage_users", "manage_firearms", "manage_equipment", "view_audit_log", "review_off_duty_requests", "submit_off_duty_requests"]) {
    assert.deepEqual(view(permission), none, permission);
  }
});

test("ownRows keeps only the caller's rows", () => {
  const rows = [{ user_id: "officer-1", score_text: "95" }, { user_id: "officer-2", score_text: "61", remedial_notes: "retest" }, { userId: "officer-1" }];
  assert.deepEqual(ownRows(rows, "officer-1", ["user_id"]), [rows[0]]);
  assert.deepEqual(ownRows(rows, "officer-1", ["userId", "user_id"]), [rows[0], rows[2]]);
  assert.deepEqual(ownRows(rows, "", ["user_id"]), []);
});

const stored = () => ({
  rangeDays: [{ id: "day-1", departmentId: "agency-a", status: "In Progress", title: "Spring" }],
  drillLibrary: [{ id: "template-1", departmentId: "agency-a", name: "Baseline" }],
  rangeDayDrills: [{ id: "drill-1", rangeDayId: "day-1", name: "Qualification" }],
  rangeRoster: [
    { id: "roster-1", rangeDayId: "day-1", officerId: "officer-1", notes: "own" },
    { id: "roster-2", rangeDayId: "day-1", officerId: "officer-2", notes: "late again" },
  ],
  results: [
    { id: "result-1", rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: "officer-1", score: 95, passed: true },
    { id: "result-2", rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: "officer-2", score: 61, passed: false, notes: "remedial: grip", remedialTrainingRecommended: true },
  ],
  malfunctions: [
    { id: "m-1", rangeDayId: "day-1", officerId: "officer-1", firearmId: "f1" },
    { id: "m-2", rangeDayId: "day-1", officerId: "officer-2", firearmId: "f2", notes: "failure to feed" },
    { id: "m-3", rangeDayId: "day-1", drillRunId: "result-1", firearmId: "f1" },
    { id: "m-4", rangeDayId: "day-1", drillRunId: "result-2", firearmId: "f2" },
  ],
  resultRevisions: [
    { id: "rev-1", collection: "results", recordId: "old-1", previous: { id: "old-1", officerId: "officer-1", score: 80 } },
    { id: "rev-2", collection: "results", recordId: "old-2", previous: { id: "old-2", officerId: "officer-2", score: 40 } },
  ],
  instructorObservations: [{ officerId: "officer-2", observation: "unsafe muzzle" }],
});

test("an officer's range workspace holds planning data and only their own rows", () => {
  const filtered = ownRangeWorkspace(stored(), "officer-1") as Record<string, Array<{ id?: string }>>;
  const ids = (key: string) => (filtered[key] ?? []).map((item) => item.id);
  assert.deepEqual(filtered.rangeDays, stored().rangeDays);
  assert.deepEqual(filtered.drillLibrary, stored().drillLibrary);
  assert.deepEqual(filtered.rangeDayDrills, stored().rangeDayDrills);
  assert.deepEqual(ids("rangeRoster"), ["roster-1"]);
  assert.deepEqual(ids("results"), ["result-1"]);
  assert.deepEqual(ids("malfunctions"), ["m-1", "m-3"]);
  assert.deepEqual(ids("resultRevisions"), ["rev-1"]);
  assert.equal("instructorObservations" in filtered, false);
  assert.doesNotMatch(JSON.stringify(filtered), /officer-2|remedial|late again|failure to feed|unsafe/);
  assert.equal(ownRangeWorkspace(null, "officer-1"), null);
  assert.deepEqual(ownRangeWorkspace({ range_roster: [{ officer_user_id: "officer-1" }, { officer_user_id: "officer-2" }] }, "officer-1"), { range_roster: [{ officer_user_id: "officer-1" }] });
});

test("a filtered GET sent back as a PUT cannot erase other officers' rows", () => {
  const existing = stored();
  const officerPermissions = ["submit_off_duty_requests"];
  assert.equal(canViewDepartmentRecords(officerPermissions, RANGE_RECORD_PERMISSIONS), false);
  const roundTrip = ownRangeWorkspace(existing, "officer-1");
  // The caller who receives a filtered document has no scoring permission.
  assert.deepEqual(authorizeRangeWorkspaceMutation({ existingWorkspace: existing, nextWorkspace: roundTrip, departmentId: "agency-a", permissions: officerPermissions }),
    { ok: false, status: 403, error: "You do not have permission to update range records." });
  // Even with one, the removal of other officers' scores is refused.
  assert.equal(authorizeRangeWorkspaceMutation({ existingWorkspace: existing, nextWorkspace: roundTrip, departmentId: "agency-a", permissions: ["score_range_days"] }).ok, false);
  // Every permission that may save the workspace also receives it unfiltered.
  for (const permission of TRACEPOINT_PERMISSIONS) {
    const saves = authorizeRangeWorkspaceMutation({ existingWorkspace: existing, nextWorkspace: existing, departmentId: "agency-a", permissions: [permission] }).ok;
    if (saves) assert.equal(canViewDepartmentRecords([permission], RANGE_RECORD_PERMISSIONS), true, permission);
  }
});

test("event attendance counts can be limited to the caller", async () => {
  const ok = (data: Record<string, unknown>[]): AgencyTrainingResult => ({ data, error: null });
  const empty = async () => ok([]);
  const data: AgencyTrainingReadDataSource = { listInstructorMemberships: empty, listProfiles: empty, listRequirements: empty, getEvent: empty, listAttendees: empty, listActiveMemberships: empty, listEventFiles: empty, listCertificates: empty, getCertificate: empty, getProfile: empty,
    listEvents: async () => ok([{ id: "event-1", agency_training_attendees: [{ id: "a1", user_id: "officer-1", outcome_status: "passed" }, { id: "a2", user_id: "officer-2", outcome_status: "failed" }, { id: "a3", user_id: "officer-3", outcome_status: "completed" }] }]) };
  const repository = new TenantBoundAgencyTrainingReadRepository(data, "dept-a");
  const [all] = await repository.listEvents({ departmentId: "dept-a" });
  assert.deepEqual([all.attendeeCount, all.completedCount], [3, 2]);
  const [own] = await repository.listEvents({ departmentId: "dept-a", attendeeUserId: "officer-2" });
  assert.deepEqual([own.attendeeCount, own.completedCount], [1, 0]);
});

test("qualification evidence lookups return the result with its officer", async () => {
  const empty = async () => ({ data: null, error: null });
  const data: EvidenceReadDataSource = { getFirearm: empty, listFirearmAttachments: empty, listQualificationEvidence: empty, listDrillDocuments: empty, getAttachment: empty,
    getRangeWorkspace: async () => ({ data: { workspace: stored() }, error: null }) };
  const repository = new TenantBoundEvidenceReadRepository(data, "dept-a");
  assert.equal((await repository.qualificationResult("dept-a", "result-2"))?.officerId, "officer-2");
  assert.equal(await repository.qualificationResult("dept-a", "missing"), null);
  assert.equal(await repository.qualificationExists("dept-a", "result-1"), true);
});

test("routes that return other officers' records apply the mapped filter", () => {
  const rangeWorkspace = source("../../app/api/pilot/range-workspace/route.ts");
  const get = rangeWorkspace.slice(rangeWorkspace.indexOf("export async function GET"), rangeWorkspace.indexOf("export async function PUT"));
  assert.match(get, /const departmentRecords = canViewDepartmentRecords\(resolved\.context\.permissions, RANGE_RECORD_PERMISSIONS\);/);
  assert.match(get, /workspace: departmentRecords \? data\.workspace : ownRangeWorkspace\(data\.workspace, resolved\.context\.userId\),/);
  // The PUT still runs the authorizer before any write.
  const put = rangeWorkspace.slice(rangeWorkspace.indexOf("export async function PUT"));
  assert.ok(put.indexOf("authorizeRangeWorkspaceMutation(") < put.indexOf('.from("pilot_range_workspaces")\n          .update'));
  assert.match(put, /if \(!decision\.ok\) \{/);

  assert.match(source("../../app/api/qualifications/route.ts"), /canViewDepartmentRecords\(permissions, RANGE_RECORD_PERMISSIONS\)\s*\? results\s*: ownRows\(results, userId, \["officerUserId"\]\)/);
  assert.match(source("../../app/api/training/certifications/route.ts"), /const certifications = context\.canManage \? data\.certifications : ownRows\(data\.certifications, context\.user\.id, \["user_id"\]\);/);
  assert.match(source("../../app/api/training/certifications/route.ts"), /canManage: hasAnyServerPermission\(resolved\.context, \["manage_certifications"\]\)/);
  const roster = source("../../app/api/agency-training/events/[eventId]/roster/route.ts");
  assert.match(roster, /attendees: canManage \? roster\.attendees : ownRows\(roster\.attendees, context\.userId, \["userId"\]\),/);
  assert.match(roster, /const MANAGE_PERMISSIONS = \[\s*"manage_training",\s*\] as const;/);
  assert.match(source("../../app/api/agency-training/events/[eventId]/files/route.ts"), /const certificates = canManage \? data\.certificates : ownRows\(data\.certificates, context\.userId, \["user_id"\]\);/);
  assert.match(source("../../app/api/agency-training/events/route.ts"), /attendeeUserId: hasAnyServerPermission\(context, AGENCY_TRAINING_SUMMARY_PERMISSIONS\) \? undefined : context\.userId,/);
  assert.match(source("../agency-training/read-repository-supabase.ts"), /"agency_training_attendees\(id,user_id,outcome_status\)"/);
  const evidence = source("../../app/api/qualifications/[resultId]/evidence/route.ts");
  assert.match(evidence, /if \(!hasAnyServerPermission\(resolved\.context, QUALIFICATION_EVIDENCE_PERMISSIONS\) &&\s*!ownRows\(\[result\], resolved\.context\.userId, \["officerId", "officerUserId", "officer_user_id", "officer_id"\]\)\.length\) \{/);
  assert.ok(evidence.indexOf("QUALIFICATION_EVIDENCE_PERMISSIONS) &&") < evidence.indexOf("listQualificationEvidence(departmentId, resultId)"));
  assert.match(source("../../app/api/attachments/[attachmentId]/download/route.ts"), /String\(result\.officerId \?\? result\.officerUserId \?\? result\.officer_user_id \?\? ""\) === resolved\.context\.userId/);
  const notifications = source("../../app/api/notifications/route.ts");
  assert.match(notifications, /getCertificationReadiness\(context\.departmentId, context\.user\.id, context\.canViewDepartmentCertifications\)/);
  assert.match(notifications, /const canViewDepartmentCertifications = hasAnyServerPermission\(\s*accessContext,\s*CERTIFICATION_SUMMARY_PERMISSIONS,\s*\);/);
  assert.match(source("./agency-training-notifications.ts"), /const isStaff = hasAnyServerPermission\(context, AGENCY_TRAINING_SUMMARY_PERMISSIONS\);/);
});

test("department-wide summary and scoring routes stay gated to their permissions", () => {
  assert.match(source("../../app/api/readiness/certifications/route.ts"), /hasAnyServerPermission\(context, \["manage_certifications", "view_command_dashboard", "view_analytics"\]\)/);
  assert.match(source("../../app/api/pilot/performance-summary/route.ts"), /if \(\s*!hasAnyServerPermission\(resolved\.context, TRAINING_ALERTS_FEED_PERMISSIONS\)\s*\) \{/);
  assert.match(source("../../app/api/command-dashboard/operations/route.ts"), /"view_command_dashboard",\s*"administer_department",/);
  assert.match(source("../../app/api/agency-training/events/[eventId]/report/route.ts"), /if \(!hasAnyServerPermission\(context, \["manage_training"\]\)\) \{/);
  for (const route of ["../../app/api/mobile/range-workspace/route.ts", "../../app/api/mobile/range-days/route.ts", "../../app/api/mobile/range-days/[rangeDayId]/route.ts"]) {
    assert.match(source(route), /hasAnyServerPermission\((resolved\.)?context, \["manage_range_days", "score_range_days", "manage_qualifications"\]\)/, route);
  }
});
