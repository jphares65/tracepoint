#!/usr/bin/env node
// Modernization register: validates docs/modernization/register/*.json and
// renders REGISTER.md and COMPLETION-MATRIX.md from them. The JSON fragments
// are the single source of truth; the Markdown files are generated.
//
//   node scripts/modernization-register.mjs           # validate + write
//   node scripts/modernization-register.mjs --check   # validate + fail if stale

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REGISTER_DIR = path.join(ROOT, "docs/modernization/register");
const REGISTER_MD = path.join(ROOT, "docs/modernization/REGISTER.md");
const MATRIX_MD = path.join(ROOT, "docs/modernization/COMPLETION-MATRIX.md");

export const STATUSES = [
  "Not Started",
  "Blocked",
  "In Progress",
  "Implemented",
  "Verified in Staging",
  "Verified in Production",
  "Rejected by Owner",
];
export const CLOSED_STATUSES = new Set(["Verified in Production", "Rejected by Owner"]);
export const CATEGORIES = ["functional", "workflow", "visual", "accessibility", "infrastructure"];
export const OWNERS = ["claude", "codex", "deployment", "unassigned"];
export const TRACKS = ["A", "B", "C", "ops"];
export const PRIORITIES = ["P0", "P1", "P2"];
export const RELEASE_STATES = ["Not released", "Released", "Verified"];
export const SOURCE_DOCS = {
  OA: "Operational audit, 2026-10-20 (docs/operational-audit-20261020)",
  UX: "UI/UX audit, 2026-10-22 (docs/uiux-audit-20261022)",
  SV: "Authenticated staging validation (uiux-audit reconciliation/register-SV, handoff SV-xx)",
  VR: "TracePoint Visual Review (sources/visual-review)",
  WR: "TracePoint Intuitive Workflow & Usability Review (sources/workflow-review)",
  BP: "Unified UI/UX Modernization Blueprint v2 (sources/blueprint-v2)",
  REM: "Operational remediation branches (UX-RB, B-, F-, DC-batches)",
};

// module key -> [prefix, label, owner, workstream group]
export const MODULES = {
  "design-system": ["DS", "Design system & global CSS", "claude", "Platform"],
  shell: ["SHELL", "Application shell & navigation", "claude", "Platform"],
  home: ["HOME", "My Home", "claude", "Platform"],
  notifications: ["NOTIF", "Notifications & inbox", "claude", "Platform"],
  "command-dashboard": ["CMD", "Command Dashboard", "claude", "Platform"],
  analytics: ["ANLY", "Analytics", "claude", "Platform"],
  help: ["HELP", "Help Center", "claude", "Platform"],
  platform: ["OPS", "Cross-cutting backend & infrastructure", "deployment", "Platform"],
  firearms: ["FA", "Department Firearms (list, record, custody)", "claude", "Armory"],
  "armory-inspections": ["INSP", "Maintenance & Inspections", "claude", "Armory"],
  ammunition: ["AMMO", "Ammunition & reconciliation", "claude", "Armory"],
  "personal-rifles": ["RIFLE", "Personally Owned Rifles", "claude", "Armory"],
  "off-duty": ["OFFD", "Off-Duty Firearms", "claude", "Armory"],
  "range-days": ["RNG", "Range Days & scoring", "codex", "Range & Training"],
  qualifications: ["QUA", "Qualifications", "codex", "Range & Training"],
  training: ["TRN", "Agency Training", "codex", "Range & Training"],
  "training-alerts": ["TALR", "Training Alerts", "codex", "Range & Training"],
  certifications: ["CERT", "Certifications", "codex", "Range & Training"],
  fleet: ["FLT", "Fleet Management", "codex", "Assets & Documents"],
  equipment: ["EQP", "Equipment", "codex", "Assets & Documents"],
  inventory: ["INV", "Inventory / Shared supplies", "codex", "Assets & Documents"],
  "agency-documents": ["DOC", "Agency Documents", "codex", "Assets & Documents"],
  settings: ["SET", "Settings & configuration", "claude", "Administration"],
  personnel: ["ADM", "Personnel, roles & permissions", "claude", "Administration"],
  "import-export": ["IMP", "Import / Export", "claude", "Administration"],
  "platform-admin": ["PLAT", "Super Admin / platform", "claude", "Administration"],
  auth: ["AUTH", "Sign-in, activation & session", "deployment", "Administration"],
};

const REQUIRED_STRING = ["id", "title", "module", "screen", "category", "owner", "track", "priority", "requirement", "status"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateRequirement(req) {
  const errors = [];
  const where = req && isNonEmptyString(req.id) ? req.id : "(no id)";
  const err = (message) => errors.push(`${where}: ${message}`);

  for (const key of REQUIRED_STRING) {
    if (!isNonEmptyString(req?.[key])) err(`missing ${key}`);
  }
  if (errors.length) return errors;

  const moduleDef = MODULES[req.module];
  if (!moduleDef) err(`unknown module "${req.module}"`);
  else if (!new RegExp(`^MOD-${moduleDef[0]}-\\d{3}$`).test(req.id)) {
    err(`id must match MOD-${moduleDef[0]}-NNN for module ${req.module}`);
  }
  if (!CATEGORIES.includes(req.category)) err(`unknown category "${req.category}"`);
  if (!OWNERS.includes(req.owner)) err(`unknown owner "${req.owner}"`);
  if (!TRACKS.includes(req.track)) err(`unknown track "${req.track}"`);
  if (!PRIORITIES.includes(req.priority)) err(`unknown priority "${req.priority}"`);
  if (!STATUSES.includes(req.status)) err(`unknown status "${req.status}"`);

  if (!Array.isArray(req.sources) || req.sources.length === 0) {
    err("needs at least one source reference");
  } else {
    for (const source of req.sources) {
      if (!SOURCE_DOCS[source?.doc]) err(`unknown source doc "${source?.doc}"`);
      if (!isNonEmptyString(source?.ref)) err("source reference without ref");
    }
  }
  if (!Array.isArray(req.acceptance) || req.acceptance.length === 0 || !req.acceptance.every(isNonEmptyString)) {
    err("needs at least one acceptance criterion");
  }
  if (req.dependencies !== undefined && !Array.isArray(req.dependencies)) err("dependencies must be a list");

  const impl = req.implementation ?? {};
  const evidence = Array.isArray(req.evidence) ? req.evidence : [];
  const staging = req.staging ?? "Not released";
  const production = req.production ?? "Not released";
  if (!RELEASE_STATES.includes(staging)) err(`unknown staging state "${staging}"`);
  if (!RELEASE_STATES.includes(production)) err(`unknown production state "${production}"`);

  const implemented = ["Implemented", "Verified in Staging", "Verified in Production"].includes(req.status);
  if (implemented && !isNonEmptyString(impl.branch) && !(impl.commits?.length > 0) && !isNonEmptyString(impl.pr)) {
    err(`status "${req.status}" needs an implementation branch, commit or PR`);
  }
  if (req.status === "Verified in Staging" && (evidence.length === 0 || staging !== "Verified")) {
    err("Verified in Staging needs evidence and staging: Verified");
  }
  if (req.status === "Verified in Production" && (evidence.length === 0 || production !== "Verified")) {
    err("Verified in Production needs evidence and production: Verified");
  }
  if (req.status === "Rejected by Owner" && !isNonEmptyString(req.ownerApproval)) {
    err("Rejected by Owner needs ownerApproval (where the owner approved the rejection)");
  }
  if (req.status === "Blocked" && !(req.dependencies?.length > 0) && !isNonEmptyString(req.notes)) {
    err("Blocked needs dependencies or notes naming the blocker");
  }
  return errors;
}

export function disposition(req) {
  if (req.status === "Verified in Production") return "Closed: verified in production";
  if (req.status === "Rejected by Owner") return `Closed: rejected by owner (${req.ownerApproval})`;
  return "Open";
}

export function loadRegister(dir = REGISTER_DIR) {
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const requirements = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.requirements;
    if (!Array.isArray(list)) throw new Error(`${file}: expected an array or { requirements: [] }`);
    for (const req of list) requirements.push({ ...req, _file: file });
  }
  return requirements;
}

export function validateRegister(requirements) {
  const errors = [];
  const ids = new Set();
  for (const req of requirements) {
    errors.push(...validateRequirement(req));
    if (ids.has(req.id)) errors.push(`${req.id}: duplicate id (${req._file})`);
    ids.add(req.id);
  }
  for (const req of requirements) {
    for (const dep of req.dependencies ?? []) {
      if (/^MOD-/.test(dep) && !ids.has(dep)) errors.push(`${req.id}: depends on unknown ${dep}`);
    }
  }
  return errors;
}

const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const refs = (req) => req.sources.map((s) => `${s.doc}:${s.ref}`).join(", ");
const impl = (req) => {
  const i = req.implementation ?? {};
  return [i.branch && `\`${i.branch}\``, ...(i.commits ?? []).map((c) => `\`${c}\``), i.pr].filter(Boolean).join(" ") || "—";
};

function byId(a, b) {
  return a.id.localeCompare(b.id, "en", { numeric: true });
}

export function renderRegister(requirements) {
  const lines = [
    "<!-- Generated by scripts/modernization-register.mjs from docs/modernization/register/*.json. Do not edit by hand. -->",
    "# Modernization register",
    "",
    "The single source of truth for the TracePoint modernization program. Edit the JSON fragments in",
    "[`register/`](register/), then run `node scripts/modernization-register.mjs`. Field definitions and",
    "the status rules are in [`register/SCHEMA.md`](register/SCHEMA.md).",
    "",
    "Source keys: " + Object.entries(SOURCE_DOCS).map(([k, v]) => `**${k}** ${v}`).join(" · "),
    "",
  ];
  const groups = new Map();
  for (const [key, def] of Object.entries(MODULES)) groups.set(key, { def, items: [] });
  for (const req of requirements) groups.get(req.module)?.items.push(req);

  for (const [key, { def, items }] of groups) {
    if (items.length === 0) continue;
    items.sort(byId);
    lines.push(`## ${def[1]} (\`${key}\`, ${def[0]}) · owner ${def[2]}`, "");
    for (const req of items) {
      lines.push(`### ${req.id} · ${cell(req.title)}`, "");
      lines.push("| Field | Value |", "|---|---|");
      lines.push(`| Screen | ${cell(req.screen)} |`);
      lines.push(`| Category · track · priority | ${req.category} · ${req.track} · ${req.priority}${req.release ? ` · ${req.release}` : ""} |`);
      lines.push(`| Owner | ${req.owner} |`);
      lines.push(`| Sources | ${cell(refs(req))} |`);
      lines.push(`| Requirement | ${cell(req.requirement)} |`);
      lines.push(`| Acceptance | ${cell(req.acceptance.map((a, i) => `${i + 1}. ${a}`).join(" "))} |`);
      lines.push(`| Dependencies | ${cell((req.dependencies ?? []).join(", ") || "—")} |`);
      lines.push(`| Implementation | ${cell(impl(req))} |`);
      lines.push(`| Evidence | ${cell((req.evidence ?? []).join("; ") || "—")} |`);
      lines.push(`| Status | **${req.status}** · staging ${req.staging ?? "Not released"} · production ${req.production ?? "Not released"} |`);
      lines.push(`| Disposition | ${cell(disposition(req))} |`);
      if (req.notes) lines.push(`| Notes | ${cell(req.notes)} |`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function renderMatrix(requirements) {
  const lines = [
    "<!-- Generated by scripts/modernization-register.mjs. Do not edit by hand. -->",
    "# Module completion matrix",
    "",
    "A module is complete only when every requirement in it is Verified in Production or Rejected by Owner.",
    "",
    `| Module | Owner | Total | ${STATUSES.join(" | ")} | Open | Complete |`,
    `|---|---|---:|${STATUSES.map(() => "---:").join("|")}|---:|---|`,
  ];
  const totals = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let grand = 0;
  let grandOpen = 0;
  for (const [key, def] of Object.entries(MODULES)) {
    const items = requirements.filter((r) => r.module === key);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, items.filter((r) => r.status === s).length]));
    const open = items.filter((r) => !CLOSED_STATUSES.has(r.status)).length;
    for (const s of STATUSES) totals[s] += counts[s];
    grand += items.length;
    grandOpen += open;
    const complete = items.length === 0 ? "No requirements" : open === 0 ? "Yes" : "No";
    lines.push(`| ${def[1]} | ${def[2]} | ${items.length} | ${STATUSES.map((s) => counts[s]).join(" | ")} | ${open} | ${complete} |`);
  }
  lines.push(`| **All modules** | | **${grand}** | ${STATUSES.map((s) => `**${totals[s]}**`).join(" | ")} | **${grandOpen}** | ${grandOpen === 0 ? "Yes" : "No"} |`);
  lines.push("", "## By owner", "", "| Owner | Total | Open |", "|---|---:|---:|");
  for (const owner of OWNERS) {
    const items = requirements.filter((r) => r.owner === owner);
    lines.push(`| ${owner} | ${items.length} | ${items.filter((r) => !CLOSED_STATUSES.has(r.status)).length} |`);
  }
  lines.push("", "## By category", "", "| Category | Total | Open |", "|---|---:|---:|");
  for (const category of CATEGORIES) {
    const items = requirements.filter((r) => r.category === category);
    lines.push(`| ${category} | ${items.length} | ${items.filter((r) => !CLOSED_STATUSES.has(r.status)).length} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const requirements = loadRegister();
  const errors = validateRegister(requirements);
  if (errors.length) {
    console.error(`Register has ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  const outputs = [
    [REGISTER_MD, renderRegister(requirements)],
    [MATRIX_MD, renderMatrix(requirements)],
  ];
  if (check) {
    // Compare without line endings: Windows checkouts may convert the committed files to CRLF.
    const normalize = (text) => text.replace(/\r\n/g, "\n");
    const stale = outputs.filter(
      ([file, text]) => !existsSync(file) || normalize(readFileSync(file, "utf8")) !== normalize(text),
    );
    if (stale.length) {
      console.error(`Stale generated files: ${stale.map(([f]) => path.relative(ROOT, f)).join(", ")}. Run node scripts/modernization-register.mjs.`);
      process.exit(1);
    }
  } else {
    for (const [file, text] of outputs) writeFileSync(file, text);
  }
  console.log(`Register OK: ${requirements.length} requirements.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
