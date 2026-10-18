import assert from "node:assert/strict";
import test from "node:test";
import { matchFieldLabel, normalizeLabel } from "./field-matcher";
import { getDocumentField } from "./field-registry";

test("normalizes widget names, tooltips and abbreviations into comparable tokens", () => {
  assert.equal(normalizeLabel("txtOfficerName").join(" "), "officer name");
  assert.equal(normalizeLabel("Badge #").join(" "), "badge number");
  assert.equal(normalizeLabel("Badge No.").join(" "), "badge number");
  assert.equal(normalizeLabel("form1[0].Page1[0].SerialNo[0]").join(" "), "form1 page1 serial number");
  assert.equal(normalizeLabel("Officer's Name:").join(" "), "officer name");
  assert.equal(normalizeLabel("S/N").join(" "), "serial number");
  assert.equal(normalizeLabel("Mfr").join(" "), "manufacturer");
  assert.equal(normalizeLabel("Pass/Fail").join(" "), "pass fail");
});

/** Labels a reasonable person would fill from TracePoint data without hesitation. */
const EXACT_CASES: Array<[string, string]> = [
  ["Officer Name", "person.full_name"],
  ["OFFICER NAME:", "person.full_name"],
  ["txtOfficerName", "person.full_name"],
  ["Name of Officer", "person.full_name"],
  ["Badge Number", "person.badge_number"],
  ["Badge #", "person.badge_number"],
  ["BadgeNo", "person.badge_number"],
  ["Agency Name", "agency.name"],
  ["Name of Department", "agency.name"],
  ["ORI", "agency.ori"],
  ["Serial Number", "firearm.serial_number"],
  ["S/N", "firearm.serial_number"],
  ["Qualification Date", "qualification.date"],
  ["Pass/Fail", "qualification.result"],
  ["Officer Rank", "person.rank"],
  ["Firearm Manufacturer", "firearm.manufacturer"],
  ["Qualification Score", "qualification.score"],
  ["Instructor Name", "qualification.instructor"],
  ["Date of Report", "document.report_date"],
  ["Prepared By", "preparer.full_name"],
  ["Chief of Police", "agency.chief_name"],
];

test("exact, unambiguous labels map deterministically and are pre-confirmed", () => {
  for (const [label, key] of EXACT_CASES) {
    const match = matchFieldLabel(label);
    assert.equal(match.status, "exact", `${label} should be exact (got ${match.status}: ${match.reason})`);
    assert.equal(match.key, key, `${label} should map to ${key}`);
    assert.ok(getDocumentField(match.key!), `${key} must exist in the registry`);
  }
});

/** Labels that look similar to a TracePoint field but refer to someone/something else. These must never be auto-filled. */
const MUST_NOT_AUTOFILL: Array<[string, string | undefined]> = [
  ["Officer Signature", undefined],
  ["Signature of Officer", undefined],
  ["Supervisor Name", undefined],
  ["Reviewing Officer", undefined],
  ["Department Head Signature", undefined],
  ["Emergency Contact Name", undefined],
  ["Officer Date of Birth", undefined],
  ["Officer Home Address", undefined],
  ["Officer Phone", undefined],
  ["Witness Name", undefined],
  ["Initials", undefined],
  ["Vehicle Serial Number", undefined],
  ["Ammunition Manufacturer", undefined],
  ["Minimum Passing Score", undefined],
  ["Next Qualification Date", undefined],
  ["Date of Hire", undefined],
  ["Agency Address", "agency.address"],
  ["Agency Phone", undefined],
  ["Previous Agency", undefined],
];

test("look-alike labels for a different person or detail are never auto-filled", () => {
  for (const [label, allowedSuggestion] of MUST_NOT_AUTOFILL) {
    const match = matchFieldLabel(label);
    if (allowedSuggestion && match.status === "exact") {
      assert.equal(match.key, allowedSuggestion, `${label} matched an unexpected field ${match.key}`);
      continue;
    }
    assert.notEqual(match.status, "exact", `${label} must not be an exact match (got ${match.key})`);
    if (match.key) {
      assert.notEqual(match.key, "person.full_name", `${label} must not suggest the selected officer's name`);
      assert.notEqual(match.key, "agency.name", `${label} must not suggest the agency name`);
    }
  }
});

test("generic or ambiguous labels are suggestions that require review, never exact", () => {
  for (const label of ["Name", "Date", "Year", "Model", "Make", "Officer", "Result", "Badge", "Rank", "Email", "Serial", "Score", "Instructor", "Agency", "Caliber", "Manufacturer"]) {
    const match = matchFieldLabel(label);
    assert.equal(match.status, "suggested", `${label} should be a reviewable suggestion (got ${match.status})`);
    assert.ok(match.reason.length > 10);
  }
});

test("bare words like 'Firearm' or 'Weapon' are never auto-mapped", () => {
  for (const label of ["Firearm", "Weapon"]) assert.notEqual(matchFieldLabel(label).status, "exact", label);
});

test("numbered list labels are not treated as the single selected record", () => {
  const match = matchFieldLabel("Serial Number 2");
  assert.equal(match.status, "suggested");
  assert.match(match.reason, /numbered/);
});

test("labels that combine two TracePoint fields are flagged with alternatives", () => {
  const match = matchFieldLabel("Officer Name and Badge");
  assert.equal(match.status, "suggested");
  assert.ok(match.alternatives.length >= 1);
});

test("unknown labels stay unmatched and are never forced onto a field", () => {
  for (const label of ["Case Number", "Incident Narrative", "Text12", "Remarks", ""]) {
    const match = matchFieldLabel(label);
    assert.equal(match.status, "unmatched", `${label} should be unmatched (got ${match.key})`);
    assert.equal(match.key, undefined);
  }
});

test("signature and checkbox widgets are never auto-mapped regardless of name", () => {
  assert.equal(matchFieldLabel("Officer Name", { fieldKind: "signature" }).status, "unmatched");
  assert.equal(matchFieldLabel("Pass", { fieldKind: "checkbox" }).status, "unmatched");
});

test("a meaningless widget name defers to a meaningful tooltip; conflicting sources become a suggestion", () => {
  const tooltipWins = matchFieldLabel(["Officer's Full Name", "Text1"]);
  assert.equal(tooltipWins.status, "exact");
  assert.equal(tooltipWins.key, "person.full_name");
  const conflict = matchFieldLabel(["Badge Number", "Serial Number"]);
  assert.equal(conflict.status, "suggested");
  assert.match(conflict.reason, /different TracePoint fields/);
});

test("mappings confirmed earlier by the agency are reused for the same label", () => {
  const learned = [{ normalizedLabel: normalizeLabel("Emp. Number").join(" "), key: "person.badge_number", templateName: "Annual Qualification" }, { normalizedLabel: "case number", key: null }];
  const reused = matchFieldLabel("Emp. Number", { learned });
  assert.equal(reused.status, "exact");
  assert.equal(reused.key, "person.badge_number");
  assert.match(reused.reason, /Annual Qualification/);
  const manual = matchFieldLabel("Case Number", { learned });
  assert.equal(manual.status, "unmatched");
  assert.match(manual.reason, /manual entry/);
  // A learned key that no longer exists in the registry is ignored rather than trusted.
  assert.equal(matchFieldLabel("Widget", { learned: [{ normalizedLabel: "widget", key: "profiles.secret" }] }).status, "unmatched");
});

test("matching is deterministic", () => {
  const first = JSON.stringify(EXACT_CASES.map(([label]) => matchFieldLabel(label)));
  const second = JSON.stringify(EXACT_CASES.map(([label]) => matchFieldLabel(label)));
  assert.equal(first, second);
});

test("a contradicting second label or section heading downgrades an exact match to review", () => {
  const cases: Array<[string[], string[]?]> = [
    [["Badge # of Supervisor", "txtBadge"]],
    [["Badge", "form1[0].Supervisor[0].Badge[0]"]],
    [["OfficerName", "Witness.OfficerName"]],
    [["Rank of Reviewing Supervisor", "Rank"]],
    [["Badge Number"], ["SUPERVISOR INFORMATION"]],
  ];
  for (const [labels, context] of cases) {
    const match = matchFieldLabel(labels, { context });
    assert.notEqual(match.status, "exact", `${labels.join(" | ")} ${context ?? ""} must not be exact (${match.reason})`);
  }
  assert.equal(matchFieldLabel(["Officer Name", "Supervisor Signature"]).status, "unmatched");
  // Wording that explains the field does not count against it.
  assert.equal(matchFieldLabel(["Instructor Name", "RangeInstructor"]).status, "exact");
  assert.equal(matchFieldLabel("Agency Address").status, "exact");
});

test("learned decisions cannot override other-person wording", () => {
  const learned = [{ normalizedLabel: "badge number", key: "person.badge_number" }];
  assert.equal(matchFieldLabel(["Badge Number", "Supervisor.BadgeNumber"], { learned }).status, "suggested");
});

test("a learned choice for a generic label is reused only as a suggestion", () => {
  const learned = [{ normalizedLabel: "name", key: "person.full_name", templateName: "Annual Qualification" }];
  const match = matchFieldLabel("Name", { learned });
  assert.equal(match.status, "suggested");
  assert.equal(match.key, "person.full_name");
  // "Submitted by" may be the officer or the preparer depending on the form.
  assert.equal(matchFieldLabel("Submitted By").status, "suggested");
});
