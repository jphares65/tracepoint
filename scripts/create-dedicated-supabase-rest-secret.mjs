import assert from "node:assert/strict";
import { SecretsManagerClient, CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createDedicatedSupabaseRestSecret } from "./dedicated-supabase-rest-secret-core.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(argument => {
  const match = /^--([^=]+)=(.+)$/.exec(argument);
  assert.ok(match, "Arguments must use --name=value syntax");
  return [match[1], match[2]];
}));
assert.deepEqual(Object.keys(args).sort(), ["profile", "region"], "Usage: node scripts/create-dedicated-supabase-rest-secret.mjs --profile=tracepoint-production --region=us-east-1");
assert.equal(args.profile, "tracepoint-production");
assert.equal(args.region, "us-east-1");
process.env.AWS_PROFILE = args.profile;
process.env.AWS_SDK_LOAD_CONFIG = "1";

const applicationSecretArn = "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/application-mkGidl";
const destinationSecretName = "tracepoint/production/migration/source-supabase-rest";
const client = new SecretsManagerClient({ region: args.region });
const adapter = {
  async getSecretValue(secretId) {
    return client.send(new GetSecretValueCommand({ SecretId: secretId }));
  },
  async createSecret(name, secretString) {
    return client.send(new CreateSecretCommand({ Name: name, SecretString: secretString }));
  },
};

try {
  const metadata = await createDedicatedSupabaseRestSecret({ client: adapter, applicationSecretArn, destinationSecretName });
  console.log(JSON.stringify({ status: "CREATED", ...metadata }));
} catch (error) {
  if (error?.name === "ResourceExistsException") {
    const existing = await client.send(new DescribeSecretCommand({ SecretId: destinationSecretName }));
    console.log(JSON.stringify({ status: "EXISTS", ARN: existing.ARN, Name: existing.Name }));
    process.exitCode = 2;
  } else {
    console.error(JSON.stringify({ status: "FAILED", errorName: error instanceof Error ? error.name : "Error" }));
    process.exitCode = 1;
  }
}
