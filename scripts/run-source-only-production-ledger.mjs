import assert from "node:assert/strict";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  AUTHORIZATION_REFERENCE, AWS_PROFILE, AWS_REGION, RUN_ID, SOURCE_DATABASE, SOURCE_SECRET_ARN,
  assertSourceOnlySql, createSanitizedEvidence, quoteIdentifier, validateInvocation, validateSourceSecret,
} from "./source-only-production-ledger-core.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(value => { const [key, item] = value.split("=", 2); return [key, item]; }));
const invocation = validateInvocation({
  runId: args["--run-id"], authorizationReference: args["--authorization-reference"],
  secretArn: args["--source-secret-arn"], profile: args["--profile"],
});

// The default provider chain reads only the explicitly selected shared production profile.
process.env.AWS_SDK_LOAD_CONFIG = "1";
process.env.AWS_PROFILE = invocation.profile;
const query = async (client, sql, values) => client.query(assertSourceOnlySql(sql), values);
const safeFailure = (phase, error) => ({ status: "FAILED", phase, errorName: error instanceof Error ? error.name : "Error", errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : undefined });

async function readSourceSecret() {
  const client = new SecretsManagerClient({ region: AWS_REGION, maxAttempts: 1 });
  const response = await client.send(new GetSecretValueCommand({ SecretId: SOURCE_SECRET_ARN }));
  assert.equal(typeof response.SecretString, "string", "Source secret has no string value");
  let parsed;
  try { parsed = JSON.parse(response.SecretString); } catch { throw new Error("Source secret schema is invalid"); }
  return validateSourceSecret(parsed);
}

async function readRelations(client) {
  const { rows } = await query(client, `select c.relname as name,case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'materialized_view' end as kind
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','v','m') and not c.relispartition order by c.relname`);
  const result = [];
  for (const row of rows) {
    const identifier = quoteIdentifier(String(row.name));
    let count;
    try {
      count = (await query(client, `select count(*)::bigint as rows from public.${identifier}`)).rows[0];
    } catch (error) {
      const blocked = new Error(`SOURCE_RELATION_UNREADABLE:${row.name}`);
      blocked.code = `SOURCE_RELATION_UNREADABLE:${row.name}`;
      throw blocked;
    }
    result.push({ name: String(row.name), kind: String(row.kind), rows: String(count.rows) });
  }
  return result;
}

async function readTenantDepartmentReconciliation(client) {
  const { rows } = await query(client, `select
    (select count(*)::int from public.departments) as department_count,
    (select count(*)::int from public.department_memberships) as membership_count,
    (select count(*)::int from public.department_memberships m left join public.departments d on d.id=m.department_id where d.id is null) as memberships_missing_department,
    (select count(*)::int from public.department_memberships m left join public.profiles p on p.id=m.user_id where p.id is null) as memberships_missing_profile`);
  const row = rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), Number(value)]));
}

async function writeEvidence(evidence) {
  const directory = path.resolve("artifacts", "source-only-ledgers");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${RUN_ID}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, file);
  return file;
}

let phase = "source secret retrieval";
let client;
try {
  const secret = await readSourceSecret();
  phase = "TLS PostgreSQL connection";
  client = new pg.Client({ host: secret.host, port: secret.port, database: secret.database, user: secret.user, password: secret.password, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
  await client.connect();
  phase = "read-only repeatable-read source snapshot";
  await query(client, "begin transaction isolation level repeatable read read only");
  await query(client, "set local statement_timeout = '30s'");
  const metadata = (await query(client, "select version() as postgres_version,clock_timestamp() at time zone 'utc' as captured_at_utc,current_setting('transaction_read_only') as transaction_read_only,current_database() as current_database")).rows[0];
  assert.equal(metadata.transaction_read_only, "on", "Source transaction is not read-only");
  assert.equal(metadata.current_database, SOURCE_DATABASE, "Connected source database is not approved");
  let snapshotId;
  try { snapshotId = (await query(client, "select pg_export_snapshot() as snapshot_id")).rows[0].snapshot_id; } catch (error) { const blocked = new Error("SOURCE_SNAPSHOT_UNAVAILABLE"); blocked.code = "SOURCE_SNAPSHOT_UNAVAILABLE"; throw blocked; }
  let lsn;
  try { lsn = (await query(client, "select pg_current_wal_lsn()::text as lsn")).rows[0].lsn; } catch (error) { const blocked = new Error("SOURCE_LSN_UNAVAILABLE"); blocked.code = "SOURCE_LSN_UNAVAILABLE"; throw blocked; }
  phase = "source table ledger";
  const tables = await readRelations(client);
  phase = "source migration ledger";
  const migrationVersions = (await query(client, "select version::text from supabase_migrations.schema_migrations order by version::text")).rows.map(row => String(row.version));
  phase = "tenant and department reconciliation";
  const tenantDepartment = await readTenantDepartmentReconciliation(client);
  phase = "source privilege evidence";
  const sourcePrivileges = (await query(client, `select
    current_setting('transaction_read_only') = 'on' as transaction_enforced_read_only,
    has_database_privilege(current_database(),'CREATE') as database_create_privilege,
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) as public_tables_with_write_privilege`)).rows[0];
  const evidence = createSanitizedEvidence({
    capturedAtUtc: new Date(metadata.captured_at_utc).toISOString(), postgresVersion: String(metadata.postgres_version), snapshotId: String(snapshotId), lsn: String(lsn), source: { host: secret.host, port: secret.port, database: secret.database, endpointKind: secret.endpointKind },
    tables, migrationVersions, tenantDepartment, sourcePrivileges: {
      transactionEnforcedReadOnly: sourcePrivileges.transaction_enforced_read_only === true,
      databaseCreatePrivilege: sourcePrivileges.database_create_privilege === true,
      publicTablesWithWritePrivilege: Number(sourcePrivileges.public_tables_with_write_privilege),
    },
  });
  await query(client, "commit");
  phase = "sanitized local evidence";
  const artifactPath = await writeEvidence(evidence);
  console.log(JSON.stringify({ status: "PASSED", artifactPath, ...evidence }, null, 2));
} catch (error) {
  await client?.query(assertSourceOnlySql("rollback")).catch(() => undefined);
  console.error(JSON.stringify(safeFailure(phase, error)));
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => undefined);
}
