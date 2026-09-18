import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { generateNativeSecretMaterial, rotateNativeKeyring, validateNativeSecretMaterial } from "./native-secret-material.mjs";

const args = new Set(process.argv.slice(2));
const rollbackIndex = process.argv.indexOf("--rollback-version");
const rollbackVersion = rollbackIndex >= 0 ? process.argv[rollbackIndex + 1] : undefined;
const operations = [args.has("--initialize"), args.has("--rotate"), Boolean(rollbackVersion)].filter(Boolean).length;
if (!args.has("--authorize-write") || operations !== 1) throw new Error("Use exactly one of --initialize, --rotate, or --rollback-version with --authorize-write.");

const region = "us-east-1", secretId = "tracepoint/staging/application";
const identity = JSON.parse(execFileSync("aws.exe", ["sts", "get-caller-identity", "--region", region, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert.equal(identity.Account, "559054714699", "Staging account mismatch.");
assert.match(identity.Arn ?? "", /:assumed-role\/TracePointMigrationStaging(?:_|\/)/, "Staging role mismatch.");
const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand, UpdateSecretVersionStageCommand } = await import("@aws-sdk/client-secrets-manager");
const client = new SecretsManagerClient({ region });

if (rollbackVersion) {
  if (!/^[A-Za-z0-9-]{16,128}$/.test(rollbackVersion)) throw new Error("Invalid rollback version id.");
  const current = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: "AWSCURRENT" }));
  await client.send(new UpdateSecretVersionStageCommand({ SecretId: secretId, VersionStage: "AWSCURRENT", MoveToVersionId: rollbackVersion, RemoveFromVersionId: current.VersionId }));
  console.log(JSON.stringify({ target: "staging", operation: "rollback", version: rollbackVersion, verified: true }));
} else {
  const current = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: "AWSCURRENT" }));
  let secret; try { secret = JSON.parse(current.SecretString ?? ""); } catch { throw new Error("Current staging secret is not valid JSON."); }
  const native = args.has("--initialize") ? generateNativeSecretMaterial() : {
    TRACEPOINT_IMPORT_APPROVAL_SECRET: generateNativeSecretMaterial().TRACEPOINT_IMPORT_APPROVAL_SECRET,
    TRACEPOINT_AUTH_STATE_KEYS: rotateNativeKeyring(secret.TRACEPOINT_AUTH_STATE_KEYS, "TRACEPOINT_AUTH_STATE_KEYS"),
    TRACEPOINT_AUTH_REFRESH_KEYS: rotateNativeKeyring(secret.TRACEPOINT_AUTH_REFRESH_KEYS, "TRACEPOINT_AUTH_REFRESH_KEYS"),
  };
  validateNativeSecretMaterial(native);
  const token = randomUUID();
  const written = await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: JSON.stringify({ ...secret, ...native }), ClientRequestToken: token, VersionStages: ["AWSCURRENT"] }));
  const readback = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionId: written.VersionId }));
  let verified; try { verified = JSON.parse(readback.SecretString ?? ""); } catch { throw new Error("Staging secret readback failed."); }
  validateNativeSecretMaterial(verified);
  console.log(JSON.stringify({ target: "staging", operation: args.has("--initialize") ? "initialize" : "rotate", version: written.VersionId, previousVersion: current.VersionId, verified: true }));
}
