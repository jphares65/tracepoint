#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { ComputeFoundationStack } from "../lib/compute-foundation-stack";
import { RuntimeStack } from "../lib/runtime-stack";

const app = new cdk.App();

const environmentName = app.node.tryGetContext("environment") ?? "staging";
const account = app.node.tryGetContext("account") ?? process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? "us-east-1";

if (!/^[a-z0-9-]+$/.test(environmentName)) {
  throw new Error("environment must use lowercase letters, numbers, and hyphens only");
}
if (environmentName !== "staging") {
  throw new Error("This assembly is restricted to the staging environment");
}
if (!account || !/^\d{12}$/.test(account)) {
  throw new Error("A 12-digit dedicated member account must be supplied with -c account=ACCOUNT_ID");
}
if (account === "265544358665") {
  throw new Error("Refusing to target the current AWS Organizations management account");
}
if (region !== "us-east-1") {
  throw new Error("TracePoint staging is restricted to us-east-1");
}

const env: cdk.Environment = { account, region };
const commonProps = {
  env,
  terminationProtection: true,
  description: `TracePoint ${environmentName} AWS foundation`,
  tags: {
    Application: "TracePoint",
    Environment: environmentName,
    ManagedBy: "AWS-CDK",
    DataClassification: "PublicSafety-Sensitive",
  },
};

const network = new NetworkStack(app, `tracepoint-${environmentName}-network`, {
  ...commonProps,
  stackName: `tracepoint-${environmentName}-network`,
  environmentName,
});

const security = new SecurityStack(app, `tracepoint-${environmentName}-security`, {
  ...commonProps,
  stackName: `tracepoint-${environmentName}-security`,
  environmentName,
});
security.addStackDependency(network);

const compute = new ComputeFoundationStack(app, `tracepoint-${environmentName}-compute`, {
  ...commonProps,
  stackName: `tracepoint-${environmentName}-compute`,
  environmentName,
  vpc: network.vpc,
  dataKey: security.dataKey,
});
compute.addStackDependency(network);
compute.addStackDependency(security);

const runtimeEnabled = app.node.tryGetContext("runtimeEnabled") === "true";
if (runtimeEnabled) {
  const certificateArn = app.node.tryGetContext("certificateArn");
  const imageTag = app.node.tryGetContext("imageTag");

  if (!certificateArn || !imageTag) {
    throw new Error(
      "runtimeEnabled=true requires non-empty certificateArn and immutable imageTag context values",
    );
  }
  if (!certificateArn.startsWith(`arn:aws:acm:${region}:${account}:certificate/`)) {
    throw new Error("certificateArn must identify an ACM certificate in the target account and us-east-1");
  }
  if (imageTag === "latest" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(imageTag)) {
    throw new Error("imageTag must be an explicit lowercase immutable tag, not latest");
  }

  const runtime = new RuntimeStack(app, `tracepoint-${environmentName}-runtime`, {
    ...commonProps,
    stackName: `tracepoint-${environmentName}-runtime`,
    environmentName,
    vpc: network.vpc,
    repository: compute.repository,
    cluster: compute.cluster,
    appLogGroup: compute.appLogGroup,
    appSecrets: compute.appSecrets,
    executionRole: compute.executionRole,
    taskRole: compute.taskRole,
    certificateArn,
    imageTag,
  });
  runtime.addStackDependency(network);
  runtime.addStackDependency(compute);
}
