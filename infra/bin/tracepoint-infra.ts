#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { ComputeFoundationStack } from "../lib/compute-foundation-stack";
import { RuntimeStack } from "../lib/runtime-stack";
import { ImageBuildStack } from "../lib/image-build-stack";

const app = new cdk.App();

const environmentName = app.node.tryGetContext("environment");
const account = app.node.tryGetContext("account");
const region = app.node.tryGetContext("region") ?? process.env.CDK_DEFAULT_REGION;
const workloadEnvironment = "staging";

if (environmentName !== "tracepoint-staging") {
  throw new Error("This assembly requires -c environment=tracepoint-staging");
}
if (!account || !/^\d{12}$/.test(account)) {
  throw new Error("The staging account must be supplied with -c account=559054714699");
}
if (account === "265544358665") {
  throw new Error("Refusing to target AWS Organizations management account 265544358665");
}
if (account !== "559054714699") {
  throw new Error("This assembly is restricted to staging account 559054714699");
}
if (region !== "us-east-1") {
  throw new Error("This assembly requires -c region=us-east-1");
}

// Keep synthesis offline and deterministic. These two AZs were verified in the
// staging inventory; no generated lookup context is written to cdk.context.json.
app.node.setContext(
  `availability-zones:account=${account}:region=${region}`,
  ["us-east-1a", "us-east-1b"],
);

const env: cdk.Environment = { account, region };
const commonProps = {
  env,
  terminationProtection: true,
  description: "TracePoint staging AWS foundation",
  tags: {
    Application: "TracePoint",
    Environment: workloadEnvironment,
    Owner: "TracePoint",
    ManagedBy: "AWS-CDK",
    CostCenter: "TracePoint-Migration",
    DataClassification: "PublicSafety-Sensitive",
  },
};

const network = new NetworkStack(app, `${environmentName}-network`, {
  ...commonProps,
  stackName: `${environmentName}-network`,
  environmentName: workloadEnvironment,
});

const security = new SecurityStack(app, `${environmentName}-security`, {
  ...commonProps,
  stackName: `${environmentName}-security`,
  environmentName: workloadEnvironment,
});
security.addStackDependency(network);

const compute = new ComputeFoundationStack(app, `${environmentName}-compute`, {
  ...commonProps,
  stackName: `${environmentName}-compute`,
  environmentName: workloadEnvironment,
  vpc: network.vpc,
  dataKey: security.dataKey,
});
compute.addStackDependency(network);
compute.addStackDependency(security);

const imageBuild = new ImageBuildStack(app, `${environmentName}-image-build`, {
  ...commonProps,
  stackName: `${environmentName}-image-build`,
  environmentName: workloadEnvironment,
  repository: compute.repository,
  appSecrets: compute.appSecrets,
});
imageBuild.addStackDependency(compute);

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

  const runtime = new RuntimeStack(app, `${environmentName}-runtime`, {
    ...commonProps,
    stackName: `${environmentName}-runtime`,
    environmentName: workloadEnvironment,
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
