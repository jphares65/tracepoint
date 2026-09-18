import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (!process.argv.includes("--execute")) throw new Error("Use --execute for the staging-only task revision.");

const ACCOUNT = "559054714699";
const REGION = "us-east-1";
const CLUSTER = "tracepoint-staging";
const SERVICE = "tracepoint-staging";
const environment = {
  ...process.env,
  AWS_PROFILE: "tracepoint-member-staging",
  AWS_REGION: REGION,
  AWS_DEFAULT_REGION: REGION,
  AWS_CLI_OUTPUT_ENCODING: "UTF-8",
};
for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) delete environment[key];

function aws(args) {
  return JSON.parse(execFileSync("aws.exe", [...args, "--region", REGION, "--output", "json"], {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  }));
}

function verifyIdentity() {
  const identity = aws(["sts", "get-caller-identity"]);
  assert.equal(identity.Account, ACCOUNT);
  assert.match(identity.Arn, /^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
}

verifyIdentity();
const service = aws(["ecs", "describe-services", "--cluster", CLUSTER, "--services", SERVICE]).services[0];
assert.equal(service.status, "ACTIVE");
assert.equal(service.desiredCount, 1);
assert.equal(service.runningCount, 1);
assert.equal(service.pendingCount, 0);
assert.equal(service.deployments.length, 1);
assert.equal(service.deployments[0].rolloutState, "COMPLETED");
assert.equal(service.deploymentConfiguration.deploymentCircuitBreaker.enable, true);
assert.equal(service.deploymentConfiguration.deploymentCircuitBreaker.rollback, true);

const previousTaskDefinitionArn = service.taskDefinition;
assert.match(previousTaskDefinitionArn, /^arn:aws:ecs:us-east-1:559054714699:task-definition\/tracepointstagingruntimeServiceTaskDefC2B9B4C5:\d+$/);
const described = aws(["ecs", "describe-task-definition", "--task-definition", previousTaskDefinitionArn, "--include", "TAGS"]);
const definition = described.taskDefinition;
assert.equal(definition.containerDefinitions.length, 1);
const container = definition.containerDefinitions[0];
assert.equal(container.name, "tracepoint");
assert.match(container.image, /^559054714699\.dkr\.ecr\.us-east-1\.amazonaws\.com\/tracepoint-staging:[a-f0-9]{40}$/);

const preferred = container.secrets.find((entry) => entry.name === "SUPABASE_SECRET_KEY");
assert.ok(preferred?.valueFrom);
assert.match(preferred.valueFrom, /^arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint\/staging\/application-[^:]+:SUPABASE_SECRET_KEY::$/);
const existingAlias = container.secrets.find((entry) => entry.name === "SUPABASE_SERVICE_ROLE_KEY");
if (existingAlias) assert.equal(existingAlias.valueFrom, preferred.valueFrom);

let nextTaskDefinitionArn = previousTaskDefinitionArn;
if (!existingAlias) {
  const allowed = [
    "family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions",
    "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory",
    "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators", "ephemeralStorage", "runtimePlatform",
  ];
  const registration = Object.fromEntries(allowed.filter((key) => definition[key] !== undefined).map((key) => [key, definition[key]]));
  registration.containerDefinitions = structuredClone(definition.containerDefinitions);
  registration.containerDefinitions[0].secrets.push({ name: "SUPABASE_SERVICE_ROLE_KEY", valueFrom: preferred.valueFrom });
  if (described.tags?.length) registration.tags = described.tags;

  const directory = mkdtempSync(path.join(tmpdir(), "tracepoint-ai-importer-task-"));
  try {
    const input = path.join(directory, "task-definition.json");
    writeFileSync(input, JSON.stringify(registration), { encoding: "utf8", flag: "wx" });
    verifyIdentity();
    const registered = aws(["ecs", "register-task-definition", "--cli-input-json", `file://${input}`]);
    nextTaskDefinitionArn = registered.taskDefinition.taskDefinitionArn;
    assert.match(nextTaskDefinitionArn, /^arn:aws:ecs:us-east-1:559054714699:task-definition\/tracepointstagingruntimeServiceTaskDefC2B9B4C5:\d+$/);
    verifyIdentity();
    const updated = aws(["ecs", "update-service", "--cluster", CLUSTER, "--service", SERVICE, "--task-definition", nextTaskDefinitionArn]);
    assert.equal(updated.service.taskDefinition, nextTaskDefinitionArn);
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.match(path.basename(resolved), /^tracepoint-ai-importer-task-/);
    rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

console.log(JSON.stringify({
  target: "isolated-staging",
  previousTaskDefinitionArn,
  nextTaskDefinitionArn,
  taskRevisionCreated: nextTaskDefinitionArn !== previousTaskDefinitionArn,
  addedSecretName: "SUPABASE_SERVICE_ROLE_KEY",
  secretValuePrinted: false,
  circuitBreakerRollbackEnabled: true,
}));
