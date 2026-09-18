import { createHash } from "node:crypto";

const TABLES = Object.freeze([
  "departments", "profiles", "department_memberships", "department_membership_roles",
  "department_role_permissions", "authentication_identity_links", "notification_preferences",
  "firearms", "equipment", "qualification_results", "audit_events",
]);
const id = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const digest = value => createHash("sha256").update(canonical(value)).digest("hex");

export function validateSyntheticTableManifest(input) {
  if (!input || input.schemaVersion !== 1 || !id(input.departmentId) || input.synthetic !== true || !Array.isArray(input.tables) || input.tables.length < 1 || input.tables.length > TABLES.length) throw new Error("Invalid bounded synthetic table manifest.");
  let total = 0;
  const names = new Set();
  for (const table of input.tables) {
    if (!TABLES.includes(table.name) || names.has(table.name) || !Array.isArray(table.primaryKey) || table.primaryKey.length < 1 || !Array.isArray(table.rows)) throw new Error("Invalid or duplicate table manifest entry.");
    names.add(table.name); total += table.rows.length;
    if (table.rows.length > 1000 || total > 5000) throw new Error("Synthetic migration row bound exceeded.");
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || table.primaryKey.some(key => row[key] === undefined)) throw new Error(`Missing primary key in ${table.name}.`);
      const tenant = table.name === "departments" ? row.id : row.department_id;
      if (tenant !== input.departmentId) throw new Error(`Cross-tenant row refused in ${table.name}.`);
    }
  }
  return { ...input, totalRows: total };
}

export function planSyntheticTableMigration(input) {
  const manifest = validateSyntheticTableManifest(input);
  const tables = manifest.tables.map(table => ({
    name: table.name,
    checkpoint: digest({ departmentId: manifest.departmentId, table: table.name, rows: table.rows }),
    rows: table.rows.map(row => ({ primaryKey: Object.fromEntries(table.primaryKey.map(key => [key, row[key]])), hash: digest(row), row })),
  }));
  return { schemaVersion: 1, departmentId: manifest.departmentId, dryRun: true, totalRows: manifest.totalRows, manifestHash: digest(manifest.tables), tables };
}

export async function executeSyntheticTableMigration(plan, adapter, { authorized = false } = {}) {
  if (!authorized) throw new Error("Explicit synthetic migration execution authorization required.");
  const checkpoints = [], rollback = [];
  await adapter.begin();
  try {
    for (const table of plan.tables) {
      if (await adapter.checkpointExists(table.name, table.checkpoint)) { checkpoints.push({ table: table.name, checkpoint: table.checkpoint, status: "already-applied" }); continue; }
      for (const item of table.rows) {
        const existing = await adapter.find(table.name, item.primaryKey, item.row);
        if (existing && digest(existing) !== item.hash) throw new Error(`Conflict refused for ${table.name}.`);
        if (!existing) { await adapter.insert(table.name, item.row); rollback.push({ table: table.name, primaryKey: item.primaryKey, insertedHash: item.hash }); }
      }
      await adapter.recordCheckpoint(table.name, table.checkpoint);
      checkpoints.push({ table: table.name, checkpoint: table.checkpoint, status: "applied" });
    }
    await adapter.reconcile(plan);
    await adapter.commit();
    return { schemaVersion: 1, departmentId: plan.departmentId, manifestHash: plan.manifestHash, checkpoints, rollback, reconciled: true };
  } catch (error) { await adapter.rollback(); throw error; }
}
