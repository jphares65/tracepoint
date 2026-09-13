#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DatabaseBootstrapRunnerStack } from "../lib/database-bootstrap-runner-stack";

const app = new cdk.App();
const context = (name: string) => app.node.tryGetContext(name);
const account = context("account");
const region = context("region");
if (account !== "193644343389" || region !== "us-east-1") throw new Error("Exact production account and region are required");
const imports = new cdk.Stack(app, "tracepoint-production-database-bootstrap-imports", { env: { account, region } });

new DatabaseBootstrapRunnerStack(app, "tracepoint-production-database-bootstrap", {
  env: { account, region },
  stackName: "tracepoint-production-database-bootstrap",
  environmentName: "production",
  vpc: cdk.aws_ec2.Vpc.fromVpcAttributes(imports, "ProductionVpc", {
    vpcId: context("vpcId"),
    availabilityZones: ["us-east-1a", "us-east-1b"],
    publicSubnetIds: String(context("publicSubnetIds") ?? "").split(",").filter(Boolean),
  }),
  databaseSecurityGroup: cdk.aws_ec2.SecurityGroup.fromSecurityGroupId(imports, "ProductionDatabaseSecurityGroup", context("databaseSecurityGroupId"), { mutable: true }),
  repository: cdk.aws_ecr.Repository.fromRepositoryName(imports, "ProductionRepository", "tracepoint-production"),
  logGroup: cdk.aws_logs.LogGroup.fromLogGroupName(imports, "ProductionApplicationLogs", "/tracepoint/production/application"),
  databaseKeyArn: context("databaseKeyArn"),
  migratorSecret: cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(imports, "ProductionMigratorSecret", context("migratorSecretArn")),
  runtimeSecret: cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(imports, "ProductionRuntimeSecret", context("runtimeSecretArn")),
  sourceCommit: context("sourceCommit"),
  imageDigest: context("imageDigest"),
  terminationProtection: true,
  description: "Temporary TracePoint production schema-only bootstrap runner; no customer data",
  tags: {
    Application: "TracePoint",
    Environment: "production",
    ManagedBy: "AWS-CDK",
    ArchitectureTarget: "full-aws",
    MigrationPhase: "pre-cutover-schema-bootstrap",
  },
});
