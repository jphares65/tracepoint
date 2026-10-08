import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyLedger } from "./aws-native-migration-ledger-core.mjs";

const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");
const ledgerRow = (version, filename, content_sha256) => ({ version, filename, content_sha256 });
const migration = (version, filename, contents) => ({ version, filename, contents, sha256: sha256(contents) });

test("AWS-native migration runner is ledgered, locked, hash-checked, and does not wrap file transactions", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  const ledgerCore = await readFile(new URL("./aws-native-migration-ledger-core.mjs", import.meta.url), "utf8");
  assert.match(runner, /tracepoint_aws_schema_migrations/);
  assert.match(runner, /createHash\("sha256"\)/);
  assert.match(ledgerCore, /MIGRATION_DRIFT/);
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /ownsTransaction/);
  assert.match(runner, /cannot be executed: AWS-native migrations must own an explicit outer BEGIN\/COMMIT transaction/);
  assert.match(runner, /replace\(\/commit;/);
  assert.match(runner, /AWS_NATIVE_BASELINE_UNVERIFIED/);
  assert.match(runner, /action === "baseline" && requestedEnvironment !== "staging"/);
});

test("AWS-native migration ledger accepts ordinary exact hashes", () => {
  const file = migration(30, "030_exact.sql", "select 30;\n");
  assert.doesNotThrow(() => verifyLedger([file], [ledgerRow(30, file.filename, file.sha256)]));
});

test("AWS-native migration ledger keeps restored historical migration 029 exact", async () => {
  const contents = await readFile(new URL("../database/aws/029_firearm_custody_phase_a_function_reconciliation.sql", import.meta.url), "utf8");
  const file = migration(29, "029_firearm_custody_phase_a_function_reconciliation.sql", contents);
  assert.doesNotThrow(() => verifyLedger([file], [ledgerRow(29, file.filename, file.sha256)]));
  assert.throws(() => verifyLedger([{ ...file, contents: `${contents} `, sha256: sha256(`${contents} `) }], [ledgerRow(29, file.filename, file.sha256)]), /MIGRATION_DRIFT/);
  assert.throws(() => verifyLedger([file], [ledgerRow(29, "029_renamed.sql", file.sha256)]), /MIGRATION_DRIFT/);
});

test("AWS-native migration ledger keeps all other versions exact", () => {
  const version1 = migration(1, "001_historical.sql", "select 1;\n");
  const version28 = migration(28, "028_historical.sql", "select 28;\n");
  const version30 = migration(30, "030_other.sql", "select 30;\n");
  assert.doesNotThrow(() => verifyLedger([version1, version28, version30], [ledgerRow(1, version1.filename, version1.sha256), ledgerRow(28, version28.filename, version28.sha256), ledgerRow(30, version30.filename, version30.sha256)]));
  assert.throws(() => verifyLedger([version28], [ledgerRow(28, version28.filename, sha256(version28.contents.replace(/\n/g, "\r\n")))]), /MIGRATION_DRIFT/);
  assert.throws(() => verifyLedger([version30], [ledgerRow(30, version30.filename, sha256(version30.contents.replace(/\n/g, "\r\n")))]), /MIGRATION_DRIFT/);
});
