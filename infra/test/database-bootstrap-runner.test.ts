import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ComputeFoundationStack } from "../lib/compute-foundation-stack";
import { DatabaseBootstrapRunnerStack } from "../lib/database-bootstrap-runner-stack";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { StagingDatabaseStack } from "../lib/staging-database-stack";

test("database bootstrap runner is immutable, bounded, secret-injected and has no legacy provider", () => {
  const app = new cdk.App();
  const env = { account: "559054714699", region: "us-east-1" };
  app.node.setContext("availability-zones:account=559054714699:region=us-east-1", ["us-east-1a", "us-east-1b"]);
  const network = new NetworkStack(app, "network", { env, environmentName: "staging" });
  const security = new SecurityStack(app, "security", { env, environmentName: "staging" });
  const compute = new ComputeFoundationStack(app, "compute", { env, environmentName: "staging", vpc: network.vpc, dataKey: security.dataKey });
  const database = new StagingDatabaseStack(app, "database", {
    env, environmentName: "staging", vpc: network.vpc, dataKey: security.dataKey,
    securityGroup: network.databaseSecurityGroup,
    expiresAfterUtc: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    leaseOwner: "synthetic-test-owner", leaseReference: "unit-test-authorization",
  });
  const stack = new DatabaseBootstrapRunnerStack(app, "bootstrap", {
    env, environmentName: "staging", vpc: network.vpc, databaseSecurityGroup: network.databaseSecurityGroup,
    repository: compute.repository, logGroup: compute.appLogGroup, databaseKeyArn: security.dataKey.keyArn, migratorSecret: database.database.secret!,
    runtimeSecret: database.runtimeSecret, sourceCommit: "a".repeat(40), imageDigest: `sha256:${"b".repeat(64)}`,
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    Cpu: "512", Memory: "1024", EphemeralStorage: { SizeInGiB: 21 },
    ContainerDefinitions: Match.arrayWith([Match.objectLike({
      Name: "bootstrap", ReadonlyRootFilesystem: true, User: "node",
      EntryPoint: ["node"],
      Command: ["scripts/bootstrap-aws-postgres-target.mjs"],
      Image: Match.anyValue(),
      Secrets: Match.arrayWith([
        Match.objectLike({ Name: "TRACEPOINT_MIGRATOR_SECRET_JSON" }),
        Match.objectLike({ Name: "TRACEPOINT_RUNTIME_DATABASE_SECRET_JSON" }),
      ]),
    })]),
  });
  const serialized = JSON.stringify(template.toJSON());
  assert.match(serialized, /AppRepository/);
  assert.match(serialized, new RegExp(`@sha256:${"b".repeat(64)}`));
  assert.doesNotMatch(serialized, /SUPABASE|BREVO|VERCEL/i);
  assert.match(serialized, /kms:Decrypt/);
  assert.match(serialized, /kms:ViaService/);
  template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 1);
  const taskPolicies = serialized.match(/TaskRole/g) ?? [];
  assert.ok(taskPolicies.length > 0);
});
