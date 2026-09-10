import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createAwsNativeApplicationSecret, validateAwsNativeApplicationSecret } from "./aws-native-application-secret-core.mjs";

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ""; };
assert.equal(args[0], "--execute");
const environment = value("--environment");
assert.ok(["staging", "production"].includes(environment));
const expectedAccount = value("--expected-account");
assert.match(expectedAccount, /^\d{12}$/);
const secretId = value("--secret-id");
assert.equal(secretId, `tracepoint/${environment}/application`);
const approval = process.env.TRACEPOINT_SECRET_INITIALIZATION_AUTHORIZATION;
assert.ok(approval && approval === value("--authorization-reference"));

function aws(command) {
  try {
    return JSON.parse(execFileSync("aws.exe", [...command, "--region", "us-east-1", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    throw new Error("AWS-native secret initialization failed; sensitive details suppressed.");
  }
}

assert.equal(aws(["sts", "get-caller-identity"]).Account, expectedAccount);
const secret = createAwsNativeApplicationSecret(environment);
validateAwsNativeApplicationSecret(secret, environment);
const write = aws(["secretsmanager", "put-secret-value", "--secret-id", secretId, "--secret-string", JSON.stringify(secret)]);
const readback = JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", secretId, "--version-id", write.VersionId]).SecretString);
validateAwsNativeApplicationSecret(readback, environment);
assert.deepEqual(readback, secret);
console.log(JSON.stringify({ environment, secretId, versionId: write.VersionId, fields: Object.keys(secret).length, legacyProviderFields: 0, valuesPrinted: false }));
