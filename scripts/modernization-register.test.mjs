import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  disposition,
  loadRegister,
  validateRegister,
  validateRequirement,
} from "./modernization-register.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "modernization-register.mjs");

function requirement(overrides = {}) {
  return {
    id: "MOD-FA-001",
    title: "Firearm rows open the record",
    module: "firearms",
    screen: "/firearms",
    category: "workflow",
    owner: "claude",
    track: "B",
    priority: "P0",
    sources: [{ doc: "UX", ref: "C-01" }],
    requirement: "Selecting a row opens the firearm drawer with a Full record link.",
    acceptance: ["Row click opens the drawer"],
    status: "Not Started",
    ...overrides,
  };
}

test("a well-formed requirement validates", () => {
  assert.deepEqual(validateRequirement(requirement()), []);
});

test("the id prefix must match the module", () => {
  const errors = validateRequirement(requirement({ id: "MOD-FLT-001" }));
  assert.ok(errors.some((e) => e.includes("MOD-FA-NNN")));
});

test("implemented work names its branch, commit or PR", () => {
  assert.ok(validateRequirement(requirement({ status: "Implemented" })).length > 0);
  assert.deepEqual(
    validateRequirement(requirement({ status: "Implemented", implementation: { branch: "claude/x" } })),
    [],
  );
});

test("verification needs evidence and the matching release state", () => {
  const base = { implementation: { branch: "claude/x" } };
  assert.ok(validateRequirement(requirement({ ...base, status: "Verified in Staging" })).length > 0);
  assert.deepEqual(
    validateRequirement(
      requirement({ ...base, status: "Verified in Staging", evidence: ["e2e run 12"], staging: "Verified" }),
    ),
    [],
  );
});

test("only an owner-approved rejection closes a requirement", () => {
  assert.ok(validateRequirement(requirement({ status: "Rejected by Owner" })).length > 0);
  const rejected = requirement({ status: "Rejected by Owner", ownerApproval: "owner chat 2026-10-22" });
  assert.deepEqual(validateRequirement(rejected), []);
  assert.match(disposition(rejected), /^Closed: rejected by owner/);
  assert.equal(disposition(requirement({ status: "Verified in Staging" })), "Open");
});

test("duplicate ids and unknown dependencies are reported", () => {
  const errors = validateRegister([
    requirement(),
    requirement(),
    requirement({ id: "MOD-FA-002", dependencies: ["MOD-DS-999"] }),
  ]);
  assert.ok(errors.some((e) => e.includes("duplicate id")));
  assert.ok(errors.some((e) => e.includes("unknown MOD-DS-999")));
});

test("the committed register is valid and its generated files are current", () => {
  assert.deepEqual(validateRegister(loadRegister()), []);
  execFileSync(process.execPath, [SCRIPT, "--check"], { stdio: "pipe" });
});
