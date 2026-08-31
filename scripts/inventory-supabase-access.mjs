import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_ROOT = path.join(ROOT, "src");
const EXCLUDED_PARTS = new Set(["node_modules", ".next", "dist", "coverage", "cdk.out"]);
const OPERATIONS = ["select", "insert", "update", "upsert", "delete"];
const AUTH_PATTERN = /\.auth(?:\.admin)?\.(getUser|getSession|listUsers|getUserById|createUser|updateUserById|deleteUser|inviteUserByEmail|generateLink)\s*\(/g;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED_PARTS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(ROOT, absolute).replaceAll("\\", "/");
    if (relative.startsWith("src/app/integration-demo/")) continue;
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/.test(entry.name) && !entry.name.endsWith(".bak")) files.push(absolute);
  }
  return files;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function boundedContext(file) {
  const normalized = file.replaceAll("\\", "/");
  const api = normalized.match(/^src\/app\/api\/([^/]+)/);
  if (api) return api[1];
  const app = normalized.match(/^src\/app\/([^/]+)/);
  if (app) return app[1];
  const tracepoint = normalized.match(/^src\/lib\/tracepoint\/([^/]+)/);
  if (tracepoint) return `shared:${tracepoint[1].replace(/\.(?:ts|tsx)$/, "")}`;
  if (normalized.startsWith("src/lib/supabase/")) return "supabase-platform";
  return "shared";
}

function clientEvidence(source, file) {
  const browser = source.includes("\"use client\"") || source.includes("'use client'") || source.includes("@/lib/supabase/client");
  const serviceRole = source.includes("createAdminClient") || source.includes("context.admin") || source.includes("resolved.context") || source.includes("access.context");
  const serverUser = source.includes("@/lib/supabase/server") || source.includes("createServerClient");
  return {
    execution: browser ? "browser" : "server",
    client: serviceRole ? "service-role" : browser ? "browser-user" : serverUser ? "server-user" : "uncertain",
    rlsReliance: serviceRole ? "bypassed" : browser || serverUser ? "relied-upon" : "uncertain",
    authorizationHelper: source.includes("resolveServerAccess")
      ? "resolveServerAccess"
      : source.includes("getServerAccessContext")
        ? "getServerAccessContext"
        : source.includes("auth.getUser")
          ? "auth.getUser"
          : file.includes("supabase/proxy")
            ? "proxy session"
            : "not statically evidenced",
  };
}

function nearestStatement(source, offset) {
  const start = Math.max(0, source.lastIndexOf(";", offset) + 1);
  let end = source.indexOf(";", offset);
  if (end < 0 || end - start > 2500) end = Math.min(source.length, offset + 1200);
  return source.slice(start, end + 1);
}

function classifyOperation(statement, kind) {
  if (kind === "rpc") return "rpc";
  for (const operation of ["insert", "update", "upsert", "delete", "select"]) {
    if (new RegExp(`\\.${operation}\\s*\\(`).test(statement)) return operation;
  }
  return "unknown";
}

function hasDepartmentFilter(statement) {
  return /\.eq\s*\(\s*["']department_id["']/.test(statement) || /departmentId/.test(statement) && /\.eq\s*\(/.test(statement);
}

function sideEffects(source, statement, operation) {
  const effects = [];
  if (["insert", "update", "upsert", "delete", "rpc"].includes(operation)) effects.push("possible mutation");
  if (/audit_events|audit_log|write_audit/.test(statement)) effects.push("audit");
  if (/notification|email/i.test(statement)) effects.push("notification/email");
  if (/storage|removeAttachment|removeDepartmentPatch/.test(source.slice(Math.max(0, source.indexOf(statement) - 300), source.indexOf(statement) + statement.length + 500))) effects.push("storage/cleanup nearby");
  return effects.length ? effects : ["none statically evidenced"];
}

function risk(client, operation, departmentFilter, statement) {
  if (client === "browser-user") return "high: browser query coupled to RLS";
  if (client === "service-role" && departmentFilter === "absent") return "high: service-role call lacks an evidenced department filter in this statement";
  if (operation === "rpc") return "high: stored-procedure semantics require SQL review";
  if (["insert", "update", "upsert", "delete"].includes(operation)) return "medium/high: mutation or workflow transaction semantics";
  if (/Promise\.all|await[\s\S]*await/.test(statement)) return "medium: possible multi-step workflow";
  return "low/medium: read contract still requires authorization tests";
}

function scanDataCalls(source, file) {
  const evidence = clientEvidence(source, file);
  const records = [];
  const pattern = /\.(from|rpc)\s*\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const kind = match[1];
    const statement = nearestStatement(source, match.index);
    const operation = classifyOperation(statement, kind);
    const departmentFilter = hasDepartmentFilter(statement) ? "present" : "absent";
    records.push({
      kind,
      target: match[2],
      operation,
      line: lineAt(source, match.index),
      boundedContext: boundedContext(file),
      ...evidence,
      departmentFilter,
      workflow: /Promise\.all|\.then\s*\(|await[\s\S]*await/.test(statement) ? "possibly multi-step" : "single statement",
      sideEffects: sideEffects(source, statement, operation),
      risk: risk(evidence.client, operation, departmentFilter, statement),
      certainty: "static source evidence; runtime authorization not proven",
    });
  }
  return records;
}

function scanAuthCalls(source, file) {
  const evidence = clientEvidence(source, file);
  const records = [];
  for (const match of source.matchAll(AUTH_PATTERN)) {
    const admin = source.slice(match.index, match.index + match[0].length).includes(".admin.");
    records.push({
      method: match[1],
      line: lineAt(source, match.index),
      boundedContext: boundedContext(file),
      ...evidence,
      privilege: admin ? "auth-admin" : "user-session",
      certainty: "static source evidence; runtime identity behavior not proven",
    });
  }
  return records;
}

function countBy(records, field) {
  return Object.fromEntries([...new Set(records.map((record) => record[field]))].sort().map((value) => [value, records.filter((record) => record[field] === value).length]));
}

async function main() {
  const files = await sourceFiles(SOURCE_ROOT);
  const dataCalls = [];
  const authCalls = [];
  const operationTokens = Object.fromEntries(OPERATIONS.map((operation) => [operation, 0]));
  for (const absolute of files) {
    const source = await readFile(absolute, "utf8");
    const file = path.relative(ROOT, absolute).replaceAll("\\", "/");
    dataCalls.push(...scanDataCalls(source, file).map((record) => ({ file, ...record })));
    authCalls.push(...scanAuthCalls(source, file).map((record) => ({ file, ...record })));
    for (const operation of OPERATIONS) operationTokens[operation] += [...source.matchAll(new RegExp(`\\.${operation}\\s*\\(`, "g"))].length;
  }
  dataCalls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target));
  authCalls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.method.localeCompare(b.method));
  const report = {
    schemaVersion: 1,
    scope: {
      sourceRoot: "src",
      extensions: [".ts", ".tsx"],
      excluded: ["generated/vendor directories", "tests/specs", "*.bak", "src/app/integration-demo/**"],
      sourceFiles: files.length,
      note: "Deterministic static source evidence only; regex analysis does not prove runtime authorization, RLS, transactionality, or reachability.",
    },
    counts: {
      dataCalls: dataCalls.length,
      fromCalls: dataCalls.filter((record) => record.kind === "from").length,
      rpcCalls: dataCalls.filter((record) => record.kind === "rpc").length,
      authCalls: authCalls.length,
      byOperation: countBy(dataCalls, "operation"),
      operationTokens,
      byExecution: countBy(dataCalls, "execution"),
      byClient: countBy(dataCalls, "client"),
      byContext: countBy(dataCalls, "boundedContext"),
      distinctTargets: new Set(dataCalls.map((record) => `${record.kind}:${record.target}`)).size,
    },
    dataCalls,
    authCalls,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const output = process.argv[outputIndex + 1];
    if (!output) throw new Error("--output requires a repository-relative path");
    const destination = path.resolve(ROOT, output);
    if (!destination.startsWith(ROOT + path.sep)) throw new Error("output must stay inside the repository");
    await writeFile(destination, serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }
}

await main();
