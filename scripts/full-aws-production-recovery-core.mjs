import assert from "node:assert/strict";

export const FULL_AWS_PRODUCTION_STACKS = Object.freeze([
  "tracepoint-production-network", "tracepoint-production-security", "tracepoint-production-compute",
  "tracepoint-production-image-build", "tracepoint-production-full-aws-storage",
  "tracepoint-production-full-aws-database", "tracepoint-production-full-aws-ses",
  "tracepoint-production-full-aws-cognito", "tracepoint-production-full-aws-ses-feedback-worker",
  "tracepoint-production-full-aws-backup", "tracepoint-production-runtime",
  "tracepoint-production-request-controls", "tracepoint-production-alert-delivery",
]);

const resourcesOf = (template, type) => Object.values(template.Resources ?? {}).filter(resource => resource.Type === type);
const retained = (resources, label) => {
  assert.ok(resources.length > 0, `${label} is absent`);
  for (const resource of resources) {
    assert.equal(resource.DeletionPolicy, "Retain", `${label} must be retained`);
    assert.equal(resource.UpdateReplacePolicy, "Retain", `${label} replacement must be retained`);
  }
};
const snapshotted = (resources, label) => {
  assert.ok(resources.length > 0, `${label} is absent`);
  for (const resource of resources) {
    assert.equal(resource.DeletionPolicy, "Snapshot", `${label} must snapshot on deletion`);
    assert.equal(resource.UpdateReplacePolicy, "Snapshot", `${label} replacement must snapshot`);
  }
};
const serialized = template => JSON.stringify(template);

export function validateFullAwsProductionRecoveryAssembly({ manifest, templates }) {
  const expectedEnvironment = "aws://193644343389/us-east-1";
  for (const stack of FULL_AWS_PRODUCTION_STACKS) {
    const artifact = manifest.artifacts?.[stack];
    assert.equal(artifact?.type, "aws:cloudformation:stack", `${stack} stack artifact is absent`);
    assert.equal(artifact.environment, expectedEnvironment, `${stack} is not pinned to the production account and region`);
    assert.equal(artifact.properties?.terminationProtection, true, `${stack} termination protection is disabled`);
    assert.ok(templates[stack], `${stack} template is absent`);
  }

  const compute = templates["tracepoint-production-compute"];
  retained(resourcesOf(compute, "AWS::ECR::Repository"), "immutable runtime repository");
  assert.ok(serialized(compute).includes("IMMUTABLE") && serialized(compute).includes("ScanOnPush"));
  retained(resourcesOf(compute, "AWS::SecretsManager::Secret"), "AWS-native application secret");
  retained(resourcesOf(compute, "AWS::Logs::LogGroup"), "application log group");

  const storage = templates["tracepoint-production-full-aws-storage"];
  retained(resourcesOf(storage, "AWS::S3::Bucket"), "production object and access-log buckets");
  assert.ok(resourcesOf(storage, "AWS::S3::Bucket").some(bucket => bucket.Properties?.VersioningConfiguration?.Status === "Enabled"));
  assert.ok(serialized(storage).includes("tracepoint-production-private-193644343389"));
  assert.ok(serialized(storage).includes("DenyExplicitWrongKmsKey"));

  const database = templates["tracepoint-production-full-aws-database"];
  const instances = resourcesOf(database, "AWS::RDS::DBInstance");
  const clusters = resourcesOf(database, "AWS::RDS::DBCluster");
  assert.equal(instances.length + clusters.length, 1, "Exactly one production PostgreSQL topology is required");
  snapshotted([...instances, ...clusters], "production PostgreSQL");
  for (const resource of [...instances, ...clusters]) {
    assert.equal(resource.Properties?.DeletionProtection, true);
    assert.equal(resource.Properties?.StorageEncrypted, true);
    if (resource.Type === "AWS::RDS::DBInstance") {
      assert.equal(resource.Properties?.PubliclyAccessible, false);
      assert.equal(resource.Properties?.MultiAZ, true);
      assert.ok(Number(resource.Properties?.BackupRetentionPeriod) >= 35);
    } else assert.ok(Number(resource.Properties?.BackupRetentionPeriod) >= 35);
  }
  retained(resourcesOf(database, "AWS::SecretsManager::Secret"), "database credentials");

  const cognito = templates["tracepoint-production-full-aws-cognito"];
  assert.equal(resourcesOf(cognito, "AWS::Cognito::UserPool").length, 1);
  assert.equal(resourcesOf(cognito, "AWS::Cognito::UserPool")[0].Properties?.DeletionProtection, "ACTIVE");
  assert.equal(resourcesOf(cognito, "AWS::Cognito::UserPoolClient").length, 1);

  const ses = templates["tracepoint-production-full-aws-ses"];
  assert.equal(resourcesOf(ses, "AWS::SES::EmailIdentity").length, 1);
  assert.equal(resourcesOf(ses, "AWS::SES::ConfigurationSet").length, 2);
  retained(resourcesOf(ses, "AWS::SQS::Queue"), "SES feedback queues");
  const sesText = serialized(ses).toUpperCase();
  assert.ok(sesText.includes("BOUNCE") && sesText.includes("COMPLAINT") && sesText.includes("DELIVERY"));
  assert.ok(serialized(ses).includes("bounce.tracepointhq.com"));

  const feedback = templates["tracepoint-production-full-aws-ses-feedback-worker"];
  assert.equal(resourcesOf(feedback, "AWS::Lambda::Function").length, 1);
  assert.ok(resourcesOf(feedback, "AWS::EC2::VPCEndpoint").length >= 2, "Secrets Manager and SNS endpoints are required");
  assert.ok(serialized(feedback).includes("ReportBatchItemFailures"));

  const backup = templates["tracepoint-production-full-aws-backup"];
  retained(resourcesOf(backup, "AWS::Backup::BackupVault"), "production backup vault");
  assert.equal(resourcesOf(backup, "AWS::Backup::BackupPlan").length, 1);
  assert.ok(serialized(backup).includes("daily") && serialized(backup).includes("monthly"));
  assert.ok(serialized(backup).includes("DeleteAfterDays"));

  const runtime = templates["tracepoint-production-runtime"];
  retained(resourcesOf(runtime, "AWS::ECS::TaskDefinition"), "digest-pinned production task definition");
  const runtimeText = serialized(runtime);
  for (const tuple of [
    'TRACEPOINT_RUNTIME_PROVIDER_MODE","Value":"aws-native', 'TRACEPOINT_DATA_PROVIDER","Value":"postgres',
    'TRACEPOINT_AUTH_PROVIDER","Value":"cognito', 'TRACEPOINT_STORAGE_PROVIDER","Value":"s3',
    'TRACEPOINT_EMAIL_PROVIDER","Value":"ses',
  ]) assert.ok(runtimeText.includes(tuple), `AWS-native runtime pin is absent: ${tuple}`);
  for (const forbidden of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "BREVO_API_KEY", ".vercel.app"]) assert.equal(runtimeText.includes(forbidden), false, `Legacy runtime value present: ${forbidden}`);
  const services = resourcesOf(runtime, "AWS::ECS::Service");
  assert.equal(services.length, 1);
  assert.equal(services[0].Properties?.DesiredCount, 2);
  assert.deepEqual(services[0].Properties?.DeploymentConfiguration?.DeploymentCircuitBreaker, { Enable: true, Rollback: true });

  const controls = templates["tracepoint-production-request-controls"];
  retained(resourcesOf(controls, "AWS::WAFv2::WebACL"), "production WAF");
  assert.ok(serialized(controls).includes("ResponseCode\":429"));

  const alerts = templates["tracepoint-production-alert-delivery"];
  retained(resourcesOf(alerts, "AWS::SQS::Queue"), "production alert queues");
  assert.ok(resourcesOf(alerts, "AWS::Events::Rule").length >= 1, "AWS Backup failure routing is absent");
  const alertText = serialized(alerts);
  for (const alarm of ["database-cpu", "database-connections", "ses-feedback-queue-age", "ses-feedback-dead-letter", "ses-feedback-worker-errors", "ses-feedback-worker-throttles"]) assert.ok(alertText.includes(alarm), `Operational alarm is absent: ${alarm}`);

  for (const template of Object.values(templates)) {
    for (const role of resourcesOf(template, "AWS::IAM::Role")) assert.ok(serialized(role.Properties?.PermissionsBoundary).includes("TracePointProductionBoundary"), "Production IAM role lacks the required permissions boundary");
  }
  return { validatedStackCount: FULL_AWS_PRODUCTION_STACKS.length, providerMode: "aws-native", immutableRuntimeRollback: true, databaseRecoveryConfigured: true, objectRecoveryConfigured: true, feedbackRecoveryConfigured: true, productionMutation: false, liveRestoreValidated: false };
}
