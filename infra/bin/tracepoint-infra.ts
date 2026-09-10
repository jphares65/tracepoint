#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { ComputeFoundationStack } from "../lib/compute-foundation-stack";
import { RuntimeStack } from "../lib/runtime-stack";
import { ImageBuildStack } from "../lib/image-build-stack";
import { directStagingSynthesizer } from "../lib/staging-synthesizer";

import { PrivateStorageStack } from "../lib/private-storage-stack";
import { StagingDatabaseStack } from "../lib/staging-database-stack";
import { CognitoFoundationStack } from "../lib/cognito-foundation-stack";
import { SesFoundationStack } from "../lib/ses-foundation-stack";
import { AlertDeliveryStack } from "../lib/alert-delivery-stack";
import { SesFeedbackWorkerStack } from "../lib/ses-feedback-worker-stack";
import { DatabaseBootstrapRunnerStack } from "../lib/database-bootstrap-runner-stack";

const app = new cdk.App();

// Production templates are an offline preview, never an authorized deployment target.
const productionPreview = app.node.tryGetContext("productionPreview") === "true";
const environmentName = productionPreview ? "tracepoint-production" : app.node.tryGetContext("environment");
const account = productionPreview ? "111111111111" : app.node.tryGetContext("account");
const region = app.node.tryGetContext("region");
const workloadEnvironment = productionPreview ? "production" : "staging";
const directDeployment=app.node.tryGetContext('directDeployment')==='true';
const providerMode = app.node.tryGetContext("providerMode") === "aws-native" ? "aws-native" : "bridge";
if(productionPreview&&directDeployment)throw Error('Direct GitHub deployment is staging-only');
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
  ...(directDeployment?{synthesizer:directStagingSynthesizer()}:{}),
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

const imageBuildQualifier = providerMode === "aws-native" ? "aws-native" : undefined;
const imageBuild = new ImageBuildStack(app, `${environmentName}${imageBuildQualifier ? `-${imageBuildQualifier}` : ""}-image-build`, {
  ...commonProps,
  stackName: `${environmentName}${imageBuildQualifier ? `-${imageBuildQualifier}` : ""}-image-build`,
  environmentName: workloadEnvironment,
  repository: compute.repository,
  appSecrets: providerMode === "aws-native" ? compute.awsNativeAppSecrets : compute.appSecrets,
  providerMode,
  resourceQualifier: imageBuildQualifier,
});
imageBuild.addStackDependency(compute);

const storageEnabled = app.node.tryGetContext("privateStorageEnabled") === "true";
const storage = storageEnabled ? new PrivateStorageStack(app, `${environmentName}-storage`, {
 ...commonProps, stackName: `${environmentName}-storage`, environmentName:workloadEnvironment,taskRole:compute.taskRole,dataKey:security.dataKey,
}) : undefined;
if (storage) storage.addStackDependency(security);
const storageProvider = app.node.tryGetContext("storageProvider") || "supabase";
if(!['supabase','s3'].includes(storageProvider)||storageProvider==='s3'&&!storage)throw new Error('Private storage must be explicitly provisioned before activation');
const databaseEnabled = app.node.tryGetContext("databaseEnabled") === "true";
const database = databaseEnabled ? new StagingDatabaseStack(app, `${environmentName}-database`, {
  ...commonProps,
  stackName: `${environmentName}-database`,
  environmentName: "staging",
  vpc: network.vpc,
  dataKey: security.dataKey,
  securityGroup: network.databaseSecurityGroup,
  expiresAfterUtc: app.node.tryGetContext("databaseExpiresAfterUtc"),
}) : undefined;
if (database) {
  database.addStackDependency(network);
  database.addStackDependency(security);
}
const ses = providerMode === "aws-native" ? new SesFoundationStack(app, `${environmentName}-ses-foundation`, {
  ...commonProps,
  stackName: `${environmentName}-ses-foundation`,
  environmentName: workloadEnvironment,
  mailFromSubdomain: "bounce",
  taskRole: compute.taskRole,
}) : undefined;
if (ses) ses.addStackDependency(compute);
const cognito = providerMode === "aws-native" && ses ? new CognitoFoundationStack(app, `${environmentName}-cognito`, {
  ...commonProps,
  stackName: `${environmentName}-cognito`,
  environmentName: workloadEnvironment,
  taskRole: compute.taskRole,
  sesFromAddress: ses.fromAddress,
  sesConfigurationSetName: ses.cognitoConfigurationSetName,
}) : undefined;
if (cognito) { cognito.addStackDependency(compute); cognito.addStackDependency(ses!); }
const sesFeedbackWorker = providerMode === "aws-native" && database && ses ? new SesFeedbackWorkerStack(app, `${environmentName}-ses-feedback-worker`, {
  ...commonProps,
  stackName: `${environmentName}-ses-feedback-worker`,
  environmentName: workloadEnvironment,
  vpc: network.vpc,
  databaseSecurityGroup: network.databaseSecurityGroup,
  databaseSecret: database.runtimeSecret,
  feedbackTopic: ses.feedbackTopic,
  feedbackQueue: ses.feedbackQueue,
  feedbackDeadLetterQueue: ses.feedbackDeadLetterQueue,
}) : undefined;
if (sesFeedbackWorker) {
  sesFeedbackWorker.addStackDependency(network);
  sesFeedbackWorker.addStackDependency(database!);
  sesFeedbackWorker.addStackDependency(ses!);
}
const databaseBootstrapEnabled = app.node.tryGetContext("databaseBootstrapEnabled") === "true";
if (databaseBootstrapEnabled && (!database || providerMode !== "aws-native")) {
  throw new Error("Database bootstrap requires the AWS-native staging database target");
}
const databaseBootstrap = databaseBootstrapEnabled && database ? new DatabaseBootstrapRunnerStack(app, `${environmentName}-database-bootstrap`, {
  ...commonProps,
  stackName: `${environmentName}-database-bootstrap`,
  environmentName: "staging",
  vpc: network.vpc,
  databaseSecurityGroup: network.databaseSecurityGroup,
  repository: compute.repository,
  logGroup: compute.appLogGroup,
  migratorSecret: database.database.secret!,
  runtimeSecret: database.runtimeSecret,
  sourceCommit: app.node.tryGetContext("bootstrapSourceCommit"),
}) : undefined;
if (databaseBootstrap) {
  databaseBootstrap.addStackDependency(network);
  databaseBootstrap.addStackDependency(compute);
  databaseBootstrap.addStackDependency(database!);
}
const alertDelivery = new AlertDeliveryStack(app, `${environmentName}-alert-delivery`, {
  ...commonProps,
  stackName: `${environmentName}-alert-delivery`,
  environment: workloadEnvironment,
  expectedAccount: account,
});
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
    appSecrets: providerMode === "aws-native" ? compute.awsNativeAppSecrets : compute.appSecrets,
    executionRole: compute.executionRole,
    taskRole: compute.taskRole,
    certificateArn,
    imageTag,
    storageBucketName: storageProvider === "s3" ? storage?.bucket.bucketName : undefined,
    providerMode,
    databaseSecret: database?.runtimeSecret,
    databaseSecurityGroup: network.databaseSecurityGroup,
    cognitoUserPoolId: cognito?.userPool.userPoolId,
    cognitoClientId: cognito?.userPoolClient.userPoolClientId,
    sesConfigurationSet: ses?.configurationSetName,
    emailFromAddress: ses?.fromAddress ?? app.node.tryGetContext("emailFromAddress"),
    desiredCount: productionPreview ? 2 : 1,
    maxCapacity: productionPreview ? 4 : undefined,
    deletionProtection: productionPreview,
  });
  if(storage && storageProvider === "s3") runtime.addStackDependency(storage);
  if(database) runtime.addStackDependency(database);
  if(cognito) runtime.addStackDependency(cognito);
  if(ses) runtime.addStackDependency(ses);
  runtime.addStackDependency(network);
  runtime.addStackDependency(compute);
  alertDelivery.addStackDependency(runtime);
}
