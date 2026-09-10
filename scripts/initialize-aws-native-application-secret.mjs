import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createAwsNativeApplicationSecret, validateAwsNativeApplicationSecret } from "./aws-native-application-secret-core.mjs";

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ""; };
assert.equal(args[0], "--execute");
const environment = value("--environment");
assert.ok(["staging", "production"].includes(environment));
const expectedAccount = value("--expected-account");
assert.match(expectedAccount, /^\d{12}$/);
const secretId = value("--secret-id");
assert.equal(secretId, `tracepoint/${environment}/application/aws-native`);
const approval = process.env.TRACEPOINT_SECRET_INITIALIZATION_AUTHORIZATION;
assert.ok(approval && approval === value("--authorization-reference"));

function awsIdentity(command) {
  try {
    return JSON.parse(execFileSync("aws.exe", [...command, "--region", "us-east-1", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    throw new Error("AWS-native secret initialization failed; sensitive details suppressed.");
  }
}

const identity = awsIdentity(["sts", "get-caller-identity"]);
assert.equal(identity.Account, expectedAccount);
if (environment === "staging") assert.equal(expectedAccount, "559054714699");
else {
  assert.ok(!["111111111111", "265544358665", "559054714699"].includes(expectedAccount));
  assert.match(identity.Arn ?? "", new RegExp(`^arn:aws:sts::${expectedAccount}:assumed-role/TracePointMigrationProduction/[^/]+$`));
}
const client = new SecretsManagerClient({ region: "us-east-1", maxAttempts: 1 });
const existingResult = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
let existing;
try { existing = JSON.parse(existingResult.SecretString ?? ""); } catch { throw new Error("AWS-native secret initialization failed; sensitive details suppressed."); }
if (existing?.initialized !== false) {
  validateAwsNativeApplicationSecret(existing, environment);
  console.log(JSON.stringify({ environment, secretId, versionId: existingResult.VersionId, fields: Object.keys(existing).length, legacyProviderFields: 0, valuesPrinted: false, alreadyInitialized: true }));
  process.exit(0);
}
const secret = createAwsNativeApplicationSecret(environment);
validateAwsNativeApplicationSecret(secret, environment);
const write = await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify(secret) }));
const readbackResult = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionId: write.VersionId }));
const readback = JSON.parse(readbackResult.SecretString ?? "");
validateAwsNativeApplicationSecret(readback, environment);
assert.deepEqual(readback, secret);
console.log(JSON.stringify({ environment, secretId, versionId: write.VersionId, fields: Object.keys(secret).length, legacyProviderFields: 0, valuesPrinted: false, alreadyInitialized: false }));
