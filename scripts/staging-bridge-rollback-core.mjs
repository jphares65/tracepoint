import assert from "node:assert/strict";

const arn = (value, suffix) => new RegExp(`^arn:aws:iam::559054714699:role/${suffix}$`).test(value ?? "");
export function validateStagingBridgeRollbackTarget(taskDefinition) {
  assert.equal(taskDefinition?.status, "ACTIVE");
  assert.equal(taskDefinition?.family, "tracepoint-staging");
  assert.ok(arn(taskDefinition.taskRoleArn, "tracepoint-staging-ecs-task"));
  assert.ok(arn(taskDefinition.executionRoleArn, "tracepoint-staging-ecs-execution"));
  assert.equal(taskDefinition.containerDefinitions?.length, 1);
  const container = taskDefinition.containerDefinitions[0];
  assert.equal(container.name, "tracepoint");
  const image = String(container.image ?? "").match(/^559054714699\.dkr\.ecr\.us-east-1\.amazonaws\.com\/tracepoint-staging:([0-9a-f]{40})$/);
  assert.ok(image, "Rollback image must be a provider-qualified bridge commit tag");
  const environment = Object.fromEntries((container.environment ?? []).map(entry => [entry.name, entry.value]));
  assert.deepEqual({
    mode: environment.TRACEPOINT_RUNTIME_PROVIDER_MODE,
    data: environment.TRACEPOINT_DATA_PROVIDER,
    auth: environment.TRACEPOINT_AUTH_PROVIDER,
    email: environment.TRACEPOINT_EMAIL_PROVIDER,
  }, { mode: "bridge", data: "supabase", auth: "supabase", email: "brevo" });
  for (const forbidden of ["TRACEPOINT_DATABASE_CA_PATH", "TRACEPOINT_COGNITO_USER_POOL_ID", "TRACEPOINT_SES_CONFIGURATION_SET"]) {
    assert.equal(environment[forbidden], undefined);
  }
  const secretNames = new Set((container.secrets ?? []).map(secret => secret.name));
  for (const required of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "BREVO_API_KEY"]) assert.ok(secretNames.has(required));
  for (const secret of container.secrets ?? []) {
    assert.match(secret.valueFrom ?? "", /^arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint\/staging\/application-[A-Za-z0-9]+:/);
    assert.doesNotMatch(secret.valueFrom, /application\/aws-native|database\/runtime/);
  }
  return Object.freeze({ valid: true, imageTag: image[1], taskRole: "bridge", secretNamespace: "tracepoint/staging/application", valuesPrinted: false });
}
