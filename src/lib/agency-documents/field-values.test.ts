import assert from "node:assert/strict";
import test from "node:test";
import { cleanValue, formatDate, requiredSelections, resolveFieldValues, splitName, type GenerationSources, type TemplateFieldSpec } from "./field-values";
import { SYNTHETIC_AGENCY, SYNTHETIC_FIREARM, SYNTHETIC_OFFICER, SYNTHETIC_PREPARER, SYNTHETIC_QUALIFICATION } from "./__fixtures__/synthetic-forms";

const g = { x: 0.1, y: 0.1, width: 0.3, height: 0.03 };
const data = (id: string, key: string, extra: Partial<TemplateFieldSpec> = {}): TemplateFieldSpec => ({ id, pageNumber: 1, fieldType: "tracepoint_data", canonicalKey: key, geometry: g, ...extra });

const sources: GenerationSources = {
  person: { id: SYNTHETIC_OFFICER.id, fullName: SYNTHETIC_OFFICER.full_name, badgeNumber: SYNTHETIC_OFFICER.badge_number, rankTitle: SYNTHETIC_OFFICER.rank_title, email: SYNTHETIC_OFFICER.email },
  firearm: { id: SYNTHETIC_FIREARM.id, make: SYNTHETIC_FIREARM.make, model: SYNTHETIC_FIREARM.model, serialNumber: SYNTHETIC_FIREARM.serial_number, caliber: SYNTHETIC_FIREARM.caliber, assetNumber: SYNTHETIC_FIREARM.asset_number, firearmType: SYNTHETIC_FIREARM.firearm_type, assignedOfficerName: SYNTHETIC_OFFICER.full_name },
  qualification: { id: SYNTHETIC_QUALIFICATION.id, date: SYNTHETIC_QUALIFICATION.qualification_date, score: SYNTHETIC_QUALIFICATION.score, passed: true, courseName: SYNTHETIC_QUALIFICATION.course_name, instructorName: SYNTHETIC_QUALIFICATION.instructor_name },
  agency: { name: SYNTHETIC_AGENCY.name, shortName: SYNTHETIC_AGENCY.shortName },
  preparer: SYNTHETIC_PREPARER,
  reportYear: 2026,
  today: "2026-10-18",
};

test("every supported field resolves from the explicitly selected records", () => {
  const fields = [
    data("a", "person.full_name"), data("b", "person.badge_number"), data("c", "person.rank"), data("d", "person.first_name"), data("e", "person.last_name"),
    data("f", "firearm.manufacturer"), data("g", "firearm.serial_number"), data("h", "firearm.assigned_officer"),
    data("i", "qualification.date"), data("j", "qualification.score"), data("k", "qualification.result"), data("l", "qualification.instructor"),
    data("m", "agency.name"), data("n", "document.report_year"), data("o", "document.report_date"), data("p", "preparer.full_name"),
  ];
  const result = resolveFieldValues(fields, sources);
  assert.equal(result.ready, true);
  const values = Object.fromEntries(result.fields.map((field) => [field.fieldId, field.value]));
  assert.deepEqual(values, { a: "Jordan A. Rivera", b: "4471", c: "Patrol Officer", d: "Jordan", e: "Rivera", f: "Example Arms", g: "EXA123456", h: "Jordan A. Rivera", i: "03/14/2026", j: "287", k: "Pass", l: "Taylor Brooks", m: "Lakeview Township Police Department", n: "2026", o: "10/18/2026", p: "Casey Morgan" });
});

test("officer fields never fall back to the person generating the document", () => {
  const result = resolveFieldValues([data("name", "person.full_name"), data("badge", "person.badge_number")], { ...sources, person: null });
  assert.equal(result.ready, false);
  for (const field of result.fields) {
    assert.equal(field.status, "missing");
    assert.equal(field.value, "");
    assert.notEqual(field.value, SYNTHETIC_PREPARER.fullName);
    assert.match(field.detail, /Select the officer/);
  }
});

test("missing TracePoint values are reported, never invented", () => {
  const sparse: GenerationSources = { ...sources, person: { id: "x", fullName: "Sam Lee", badgeNumber: null, rankTitle: "  " }, agency: { name: "" }, qualification: { id: "q", date: "not-a-date", passed: null } };
  const result = resolveFieldValues([data("badge", "person.badge_number"), data("rank", "person.rank"), data("agency", "agency.name"), data("ori", "agency.ori"), data("date", "qualification.date"), data("result", "qualification.result")], sparse);
  assert.equal(result.ready, false);
  assert.equal(result.missing.length, 6);
  for (const field of result.fields) assert.equal(field.value, "");
  assert.match(result.fields.find((f) => f.fieldId === "ori")!.detail, /not stored in TracePoint/);
});

test("a typed value can stand in for missing data and is labelled as typed", () => {
  const result = resolveFieldValues([data("ori", "agency.ori"), data("name", "person.full_name")], sources, { entered: { ori: "NJ0000000", name: "Someone Else" } });
  const ori = result.fields.find((f) => f.fieldId === "ori")!;
  assert.equal(ori.value, "NJ0000000");
  assert.equal(ori.status, "typed");
  // Typed text never overrides a value TracePoint already has.
  const name = result.fields.find((f) => f.fieldId === "name")!;
  assert.equal(name.value, "Jordan A. Rivera");
  assert.equal(name.status, "filled");
});

test("a person can explicitly choose to leave a missing field blank", () => {
  const result = resolveFieldValues([data("ori", "agency.ori")], sources, { leaveBlank: ["ori"] });
  assert.equal(result.ready, true);
  assert.equal(result.fields[0]!.status, "blank");
});

test("manual fields: required ones block generation until entered; optional ones may stay blank", () => {
  const fields: TemplateFieldSpec[] = [
    { id: "case", pageNumber: 1, fieldType: "manual", label: "Case Number", required: true, geometry: g },
    { id: "remarks", pageNumber: 1, fieldType: "manual", label: "Remarks", required: false, geometry: g },
  ];
  const blocked = resolveFieldValues(fields, sources);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.missing.map((m) => m.fieldId), ["case"]);
  const ready = resolveFieldValues(fields, sources, { entered: { case: "  26-001234 " } });
  assert.equal(ready.ready, true);
  assert.equal(ready.fields[0]!.value, "26-001234");
  assert.equal(ready.fields[1]!.status, "blank");
});

test("static and generated-date fields resolve from the template and the generation date", () => {
  const fields: TemplateFieldSpec[] = [
    { id: "ori", pageNumber: 1, fieldType: "static_text", staticText: "NJ0141400", geometry: g },
    { id: "today", pageNumber: 1, fieldType: "generated_date", geometry: g, formatting: { dateFormat: "Month D, YYYY" } },
    { id: "empty", pageNumber: 1, fieldType: "static_text", staticText: " ", geometry: g },
  ];
  const result = resolveFieldValues(fields, sources);
  assert.deepEqual(result.fields.map((f) => [f.value, f.status]), [["NJ0141400", "static"], ["October 18, 2026", "filled"], ["", "missing"]]);
});

test("fields pointing at unknown or removed TracePoint keys are blocked, not guessed", () => {
  const result = resolveFieldValues([data("x", "profiles.secret_column")], sources);
  assert.equal(result.fields[0]!.status, "missing");
  assert.match(result.fields[0]!.detail, /no longer exists/);
});

test("names, dates and text are normalized conservatively", () => {
  assert.deepEqual(splitName("John Q. Public Jr."), { first: "John", last: "Public" });
  assert.deepEqual(splitName("Cher"), { first: "Cher", last: "" });
  assert.deepEqual(splitName("Juan De La Cruz"), { first: "", last: "" });
  assert.deepEqual(splitName("Mary Ann Van Der Berg"), { first: "", last: "" });
  assert.deepEqual(splitName("Sgt. Jordan Rivera"), { first: "", last: "" });
  assert.deepEqual(splitName("Jordan Rivera"), { first: "Jordan", last: "Rivera" });
  assert.equal(formatDate("2026-02-30"), "");
  assert.equal(formatDate("2026-02-03T10:00:00Z", "YYYY-MM-DD"), "2026-02-03");
  assert.equal(formatDate("02/03/2026"), "");
  assert.equal(cleanValue("  a\u0000b \t c "), "ab c");
});

test("the generate screen asks only for the selections the template needs", () => {
  assert.deepEqual(requiredSelections([data("a", "person.full_name"), data("b", "document.report_year")]), { person: true, firearm: false, qualification: false, reportYear: true });
});
