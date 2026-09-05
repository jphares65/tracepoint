#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { ComputeFoundationStack } from "../lib/compute-foundation-stack";
import { RuntimeStack } from "../lib/runtime-stack";
import { ImageBuildStack } from "../lib/image-build-stack";

const app = new cdk.App();

// Production templates are an offline preview, never an authorized deployment target.
const productionPreview = app.node.tryGetContext("productionPreview") === "true";
const environmentName = productionPreview ? "tracepoint-production" : app.node.tryGetContext("environment");
const account = productionPreview ? "111111111111" : app.node.tryGetContext("account");
const region = app.node.tryGetContext("region");
const workloadEnvironment = productionPreview ? "production" : "staging";
if (app.node.tryGetContext("account") === "265544358665") throw new Error("Management account is forbidden");
if (region !== "us-east-1") throw new Error("Region must equal us-east-1");
if (productionPreview) {
  if (app.node.tryGetContext("account") !== "111111111111") throw new Error("Production preview requires placeholder account 111111111111");
  if (process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_ACCOUNT !== "111111111111") throw new Error("Production preview must run offline without AWS credentials");
} else if (environmentName !== "tracepoint-staging" || account !== "559054714699") {
  throw new Error("Deployment assembly is restricted to tracepoint-staging account 559054714699");
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
  description: productionPreview ? "TracePoint production OFFLINE PREVIEW - not authorized for deployment" : "TracePoint staging AWS foundation",
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
  logRetention: productionPreview ? cdk.aws_logs.RetentionDays.ONE_YEAR : cdk.aws_logs.RetentionDays.ONE_MONTH,
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
    desiredCount: productionPreview ? 2 : 1,
    maxCapacity: productionPreview ? 4 : undefined,
    deletionProtection: productionPreview,
  });
  runtime.addStackDependency(network);
  runtime.addStackDependency(compute);
}
