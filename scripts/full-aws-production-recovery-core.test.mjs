import test from "node:test";
import assert from "node:assert/strict";
import * as cdk from "../infra/node_modules/aws-cdk-lib/index.js";
import { fullAwsProductionAssembly } from "../infra/lib/full-aws-production-assembly.ts";
import { FULL_AWS_PRODUCTION_STACKS, validateFullAwsProductionRecoveryAssembly } from "./full-aws-production-recovery-core.mjs";

const target = { account: "193644343389", region: "us-east-1", roleArn: "arn:aws:iam::193644343389:role/TracePointMigrationProduction", hostname: "tracepointhq.com", certificateArn: "arn:aws:acm:us-east-1:193644343389:certificate/11111111-1111-4111-8111-111111111111", imageTag: `${"a".repeat(40)}-aws-native`, imageDigest: `sha256:${"b".repeat(64)}`, architectureTarget: "full-aws", deploymentPhase: "full-aws-final", dataMode: "aws-postgres-authoritative", authMode: "cognito", storageMode: "s3", emailMode: "ses", databaseTopology: "rds-multi-az", desiredCount: 2, maxCapacity: 4 };

function synthesized() {
  const app = new cdk.App();
  const stacks = fullAwsProductionAssembly(app, target, true);
  const assembly = app.synth();
  const manifest = assembly.manifest;
  const templates = Object.fromEntries(Object.values(stacks).map(stack => [stack.stackName, assembly.getStackArtifact(stack.artifactId).template]));
  return { manifest, templates };
}
const baseline = synthesized();

test("validates the full 13-stack AWS-native recovery assembly", () => {
  const result = validateFullAwsProductionRecoveryAssembly(structuredClone(baseline));
  assert.equal(result.validatedStackCount, 13);
  assert.equal(result.providerMode, "aws-native");
  assert.equal(result.liveRestoreValidated, false);
});

test("rejects missing stacks and any legacy runtime configuration", () => {
  const missing = structuredClone(baseline);
  delete missing.templates[FULL_AWS_PRODUCTION_STACKS[0]];
  assert.throws(() => validateFullAwsProductionRecoveryAssembly(missing), /template is absent/);
  const legacy = structuredClone(baseline);
  const runtime = legacy.templates["tracepoint-production-runtime"];
  const task = Object.values(runtime.Resources).find(resource => resource.Type === "AWS::ECS::TaskDefinition");
  task.Properties.ContainerDefinitions[0].Environment.push({ Name: "BREVO_API_KEY", Value: "forbidden" });
  assert.throws(() => validateFullAwsProductionRecoveryAssembly(legacy), /Legacy runtime value/);
});
