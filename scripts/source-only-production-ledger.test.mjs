import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTHORIZATION_REFERENCE, AWS_PROFILE, DIRECT_SOURCE_HOST, RUN_ID, SESSION_POOLER_SOURCE_HOST, SOURCE_SECRET_ARN,
  assertSourceOnlySql, createSanitizedEvidence, validateInvocation, validateSourceSecret,
} from "./source-only-production-ledger-core.mjs";

test("source-only invocation accepts only the approved production run, profile, and secret", () => {
  assert.deepEqual(validateInvocation({ runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, secretArn: SOURCE_SECRET_ARN, profile: AWS_PROFILE }), { runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, secretArn: SOURCE_SECRET_ARN, profile: AWS_PROFILE });
  assert.throws(() => validateInvocation({ runId: "other", authorizationReference: AUTHORIZATION_REFERENCE, secretArn: SOURCE_SECRET_ARN, profile: AWS_PROFILE }));
});

test("source secret validation permits exactly the reviewed direct and Session Pooler connection tuples", () => {
  const direct = validateSourceSecret({ host: DIRECT_SOURCE_HOST, port: 5432, dbname: "postgres", username: "postgres", password: "redacted" });
  const pooler = validateSourceSecret({ host: SESSION_POOLER_SOURCE_HOST, port: 5432, dbname: "postgres", username: "postgres.izlkwggluhlhzlumtzes", password: "redacted" });
  assert.equal(direct.endpointKind, "direct");
  assert.equal(pooler.endpointKind, "session-pooler");
  for (const candidate of [
    { host: SESSION_POOLER_SOURCE_HOST, port: 5432, dbname: "postgres", username: "postgres.wrongprojectref000", password: "redacted" },
    { host: "aws-2-us-east-1.pooler.supabase.com", port: 5432, dbname: "postgres", username: "postgres.izlkwggluhlhzlumtzes", password: "redacted" },
    { host: "arbitrary.supabase.com", port: 5432, dbname: "postgres", username: "postgres", password: "redacted" },
    { host: SESSION_POOLER_SOURCE_HOST, port: 6543, dbname: "postgres", username: "postgres.izlkwggluhlhzlumtzes", password: "redacted" },
  ]) assert.throws(() => validateSourceSecret(candidate));
});

test("source-only SQL guard permits reads and rejects write, DDL, and target-write statements", () => {
  for (const sql of ["begin transaction isolation level repeatable read read only", "set local statement_timeout = '30s'", "select count(*) from public.profiles", "commit", "rollback"]) assert.doesNotThrow(() => assertSourceOnlySql(sql));
  for (const sql of ["insert into public.profiles values (1)", "update public.profiles set email='x'", "create table public.forbidden(id int)", "delete from public.profiles", "select pg_sleep(1); delete from public.profiles"]) assert.throws(() => assertSourceOnlySql(sql));
});

test("sanitized evidence excludes source credentials, identifiers, emails, and target-client state", () => {
  const evidence = createSanitizedEvidence({ capturedAtUtc: "2026-09-20T00:00:00.000Z", postgresVersion: "PostgreSQL test", snapshotId: "00000001-1", lsn: "0/1", source: { host: SESSION_POOLER_SOURCE_HOST, port: 5432, database: "postgres", endpointKind: "session-pooler" }, tables: [{ name: "profiles", kind: "table", rows: "96" }], migrationVersions: ["202601010001"], identities: { identityCount: 96, membershipCount: 95 }, sourcePrivileges: { transactionEnforcedReadOnly: true, databaseCreatePrivilege: false, publicTablesWithWritePrivilege: 0 } });
  const output = JSON.stringify(evidence);
  assert.doesNotMatch(output, /password|username|@example\.com|user_id|department_id/i);
  assert.equal(evidence.privacy.targetClientsInitialized, false);
});

test("runner imports only the source database and Secrets Manager clients", async () => {
  const source = await readFile(new URL("./run-source-only-production-ledger.mjs", import.meta.url), "utf8");
  assert.match(source, /@aws-sdk\/client-secrets-manager/);
  assert.match(source, /import pg from "pg"/);
  assert.doesNotMatch(source, /@aws-sdk\/client-(?:s3|cognito|ecs|rds|cloudformation)/);
  assert.doesNotMatch(source, /pg_dump|pg_restore|TARGET_DATABASE_SECRET_JSON|SOURCE_DATABASE_SECRET_JSON/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:password|username|SecretString)/i);
});
