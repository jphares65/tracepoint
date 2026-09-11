import assert from "node:assert/strict";
import test from "node:test";
import { validateStagingBridgeRollbackTarget } from "./staging-bridge-rollback-core.mjs";

const definition = () => ({
  family: "tracepoint-staging", status: "ACTIVE",
  taskRoleArn: "arn:aws:iam::559054714699:role/tracepoint-staging-ecs-task",
  executionRoleArn: "arn:aws:iam::559054714699:role/tracepoint-staging-ecs-execution",
  containerDefinitions: [{
    name: "tracepoint", image: `559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:${"a".repeat(40)}`,
    environment: [
      { name: "TRACEPOINT_RUNTIME_PROVIDER_MODE", value: "bridge" }, { name: "TRACEPOINT_DATA_PROVIDER", value: "supabase" },
      { name: "TRACEPOINT_AUTH_PROVIDER", value: "supabase" }, { name: "TRACEPOINT_EMAIL_PROVIDER", value: "brevo" },
    ],
    secrets: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "BREVO_API_KEY"].map(name => ({ name, valueFrom: `arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/application-AbCd12:${name}::` })),
  }],
});

test("accepts only the exact retained staging bridge boundary", () => {
  assert.equal(validateStagingBridgeRollbackTarget(definition()).imageTag, "a".repeat(40));
  for (const mutate of [
    value => { value.taskRoleArn = value.taskRoleArn.replace("ecs-task", "aws-native-ecs-task"); },
    value => { value.containerDefinitions[0].environment[0].value = "aws-native"; },
    value => { value.containerDefinitions[0].image += "-aws-native"; },
    value => { value.containerDefinitions[0].secrets[0].valueFrom = value.containerDefinitions[0].secrets[0].valueFrom.replace("application-", "application/aws-native-"); },
  ]) { const value = definition(); mutate(value); assert.throws(() => validateStagingBridgeRollbackTarget(value)); }
});
