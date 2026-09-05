import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface ComputeFoundationStackProps extends cdk.StackProps {
  environmentName: string;
  vpc: ec2.IVpc;
  dataKey: kms.IKey;
  logRetention?: logs.RetentionDays;
}

export class ComputeFoundationStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  public readonly cluster: ecs.Cluster;
  public readonly appLogGroup: logs.LogGroup;
  public readonly appSecrets: secretsmanager.Secret;
  public readonly executionRole: iam.Role;
  public readonly taskRole: iam.Role;

  constructor(scope: Construct, id: string, props: ComputeFoundationStackProps) {
    super(scope, id, props);

    const dataKey = kms.Key.fromKeyArn(this, "ImportedDataKey", props.dataKey.keyArn);

    this.repository = new ecr.Repository(this, "AppRepository", {
      repositoryName: `tracepoint-${props.environmentName}`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.KMS,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        { description: "Keep the latest 30 images", maxImageCount: 30 },
      ],
    });

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: props.vpc,
      clusterName: `tracepoint-${props.environmentName}`,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    this.appLogGroup = new logs.LogGroup(this, "AppLogGroup", {
      logGroupName: `/tracepoint/${props.environmentName}/application`,
      retention: props.logRetention ?? logs.RetentionDays.ONE_MONTH,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Placeholder secret container only. Values are intentionally not populated
    // by CDK so no application credentials are committed to source control.
    this.appSecrets = new secretsmanager.Secret(this, "AppSecrets", {
      secretName: `tracepoint/${props.environmentName}/application`,
      description: "TracePoint application secrets. Populate manually/through approved deployment workflow.",
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ initialized: false }),
        generateStringKey: "bootstrapNonce",
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const ecsTasksPrincipal = new iam.ServicePrincipal("ecs-tasks.amazonaws.com", {
      conditions: {
        ArnLike: {
          "aws:SourceArn": cdk.Stack.of(this).formatArn({
            service: "ecs",
            resource: "*",
          }),
        },
        StringEquals: { "aws:SourceAccount": this.account },
      },
    });

    this.executionRole = new iam.Role(this, "TaskExecutionRole", {
      roleName: `tracepoint-${props.environmentName}-ecs-execution`,
      assumedBy: ecsTasksPrincipal,
      description: "Pulls the immutable TracePoint image, writes application logs, and injects the staging secret",
    });
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ],
        resources: [this.repository.repositoryArn],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${this.appLogGroup.logGroupArn}:*`],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [this.appSecrets.secretArn],
      }),
    );
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [dataKey.keyArn],
      }),
    );

    this.taskRole = new iam.Role(this, "TaskRole", {
      roleName: `tracepoint-${props.environmentName}-ecs-task`,
      assumedBy: ecsTasksPrincipal,
      description: "Least-privilege runtime role for the TracePoint application",
    });

    new cdk.CfnOutput(this, "EcrRepositoryUri", { value: this.repository.repositoryUri });
    new cdk.CfnOutput(this, "EcsClusterName", { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, "ApplicationLogGroupName", { value: this.appLogGroup.logGroupName });
    new cdk.CfnOutput(this, "ApplicationSecretArn", { value: this.appSecrets.secretArn });
    new cdk.CfnOutput(this, "TaskExecutionRoleArn", { value: this.executionRole.roleArn });
    new cdk.CfnOutput(this, "TaskRoleArn", { value: this.taskRole.roleArn });
  }
}
