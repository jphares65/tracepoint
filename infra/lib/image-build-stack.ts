import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface ImageBuildStackProps extends cdk.StackProps {
  environmentName: string;
  repository: ecr.IRepository;
  appSecrets: secretsmanager.ISecret;
  productionControls?: boolean;
  providerMode?: "bridge" | "aws-native";
}

export class ImageBuildStack extends cdk.Stack {
  public readonly project: codebuild.Project;
  public readonly sourceBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ImageBuildStackProps) {
    super(scope, id, props);

    const buildKey = new kms.Key(this, "BuildKey", {
      alias: `alias/tracepoint/${props.environmentName}/build`,
      description: `TracePoint ${props.environmentName} build source and log encryption`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const buildLogGroupName = `/tracepoint/${props.environmentName}/image-build`;
    const buildLogGroupArn = this.formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: buildLogGroupName,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    buildKey.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:Describe*",
        ],
        resources: ["*"],
        conditions: {
          ArnEquals: { "kms:EncryptionContext:aws:logs:arn": buildLogGroupArn },
        },
      }),
    );

    const accessLogBucket = props.productionControls ? new s3.Bucket(this, "BuildAccessLogs", {
      bucketName: `tracepoint-${props.environmentName}-build-access-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{id:"expire-build-access-logs",expiration:cdk.Duration.days(90)}],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    }) : undefined;
    if (accessLogBucket) NagSuppressions.addResourceSuppressions(accessLogBucket, [{
      id: "AwsSolutions-S1",
      reason: "This dedicated bucket is the terminal server-access-log destination; recursive access logging is neither useful nor supported.",
    }]);

    this.sourceBucket = new s3.Bucket(this, "SourceBucket", {
      bucketName: `tracepoint-${props.environmentName}-build-source-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: buildKey,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogBucket,
      serverAccessLogsPrefix: accessLogBucket ? "source/" : undefined,
      lifecycleRules: [
        {
          id: "expire-clean-source-archives",
          expiration: cdk.Duration.days(7),
          noncurrentVersionExpiration: cdk.Duration.days(7),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const buildLogGroup = new logs.LogGroup(this, "BuildLogGroup", {
      logGroupName: buildLogGroupName,
      encryptionKey: buildKey,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const projectName = `tracepoint-${props.environmentName}-image-build`;
    const projectArn = this.formatArn({
      service: "codebuild",
      resource: "project",
      resourceName: projectName,
    });
    const buildRole = new iam.Role(this, "BuildRole", {
      roleName: `tracepoint-${props.environmentName}-codebuild-image`,
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com", {
        conditions: {
          ArnEquals: { "aws:SourceArn": projectArn },
          StringEquals: { "aws:SourceAccount": this.account },
        },
      }),
      description: `Builds a reviewed TracePoint commit and pushes only to ${props.environmentName} ECR`,
    });

    this.sourceBucket.grantRead(buildRole, `source/tracepoint-${props.environmentName}-source.zip`);
    props.repository.grantPullPush(buildRole);
    buildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:DescribeImages"],
        resources: [props.repository.repositoryArn],
      }),
    );
    buildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    if (!props.appSecrets.encryptionKey) {
      throw new Error(`The ${props.environmentName} application secret must use a customer-managed KMS key`);
    }
    buildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [props.appSecrets.encryptionKey.keyArn],
        conditions: {
          StringEquals: {
            "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com`,
          },
        },
      }),
    );
    const secretVariable = (jsonKey: string): codebuild.BuildEnvironmentVariable => ({
      type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
      value: `${props.appSecrets.secretArn}:${jsonKey}::`,
    });

    const providerMode = props.providerMode ?? "bridge";
    const environmentVariables: Record<string, codebuild.BuildEnvironmentVariable> = {
      AWS_ACCOUNT_ID: { value: this.account },
      CONFIGURATION_ENVIRONMENT: { value: props.environmentName },
      ECR_REPOSITORY_URI: { value: props.repository.repositoryUri },
      TRACEPOINT_BUILD_PROVIDER_MODE: { value: providerMode },
      NEXT_PUBLIC_TRACEPOINT_PROVIDER_MODE: { value: providerMode },
      NEXT_PUBLIC_SITE_URL: secretVariable("NEXT_PUBLIC_SITE_URL"),
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: secretVariable("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"),
    };
    if (providerMode === "bridge") {
      environmentVariables.NEXT_PUBLIC_SUPABASE_URL = secretVariable("NEXT_PUBLIC_SUPABASE_URL");
      environmentVariables.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = secretVariable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    }

    this.project = new codebuild.Project(this, "ImageBuildProject", {
      projectName,
      description: `Builds immutable TracePoint ${props.environmentName} images from a clean reviewed Git archive`,
      role: buildRole,
      encryptionKey: buildKey,
      source: codebuild.Source.s3({
        bucket: this.sourceBucket,
        path: `source/tracepoint-${props.environmentName}-source.zip`,
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(`buildspec.${props.environmentName}-image.yml`),
      grantReportGroupPermissions: false,
      timeout: cdk.Duration.minutes(30),
      queuedTimeout: cdk.Duration.minutes(15),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables,
      },
      logging: {
        cloudWatch: {
          logGroup: buildLogGroup,
          prefix: "build",
        },
      },
    });

    if (props.productionControls) {
      const buildPolicy = buildRole.node.findChild("DefaultPolicy");
      NagSuppressions.addResourceSuppressions(buildPolicy, [{
        id:"AwsSolutions-IAM5",
        reason:"ECR authorization is not resource-scoped; CDK's source grant remains on one reviewed archive, KMS wildcard action suffixes remain on the exact build key, and CodeBuild streams remain under its own project group.",
        appliesTo:["Resource::*","Action::s3:GetBucket*","Action::s3:GetObject*","Action::s3:List*","Action::kms:GenerateDataKey*","Action::kms:ReEncrypt*",`Resource::arn:<AWS::Partition>:logs:${this.region}:${this.account}:log-group:/aws/codebuild/<ImageBuildProject74D885BB>:*`]
      }]);
    }

    new cdk.CfnOutput(this, "ImageBuildProjectName", { value: this.project.projectName });
    new cdk.CfnOutput(this, "ImageBuildSourceBucketName", {
      value: this.sourceBucket.bucketName,
    });
    new cdk.CfnOutput(this, "ImageBuildSourceObjectKey", {
      value: `source/tracepoint-${props.environmentName}-source.zip`,
    });
  }
}
