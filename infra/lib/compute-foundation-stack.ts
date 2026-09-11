import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from "cdk-nag";
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
  public readonly awsNativeAppSecrets: secretsmanager.Secret;
  public readonly executionRole: iam.Role;
  public readonly taskRole: iam.Role;
  public readonly awsNativeExecutionRole: iam.Role;
  public readonly awsNativeTaskRole: iam.Role;

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
      containerInsightsV2: props.environmentName === "production" ? ecs.ContainerInsights.ENHANCED : ecs.ContainerInsights.DISABLED,
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
    this.awsNativeAppSecrets = new secretsmanager.Secret(this, "AwsNativeAppSecrets", {
      secretName: `tracepoint/${props.environmentName}/application/aws-native`,
      description: "TracePoint AWS-native application secrets; deliberately separate from the rollback bridge secret.",
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
      description: `Pulls the immutable TracePoint image, writes application logs, and injects the ${props.environmentName} secret`,
    });
    this.awsNativeExecutionRole = new iam.Role(this, "AwsNativeTaskExecutionRole", {
      roleName: `tracepoint-${props.environmentName}-aws-native-ecs-execution`,
      assumedBy: ecsTasksPrincipal,
      description: "Pulls the immutable AWS-native image, writes logs, and injects only AWS-native secrets",
    });
    const configureExecutionRole = (role: iam.Role, applicationSecret: secretsmanager.ISecret) => {
      role.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
        resources: [this.repository.repositoryArn],
      }));
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${this.appLogGroup.logGroupArn}:*`],
      }));
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [applicationSecret.secretArn],
      }));
      role.addToPolicy(new iam.PolicyStatement({ actions: ["kms:Decrypt"], resources: [dataKey.keyArn] }));
    };
    configureExecutionRole(this.executionRole, this.appSecrets);
    configureExecutionRole(this.awsNativeExecutionRole, this.awsNativeAppSecrets);

    if (props.environmentName === "production") {
      NagSuppressions.addResourceSuppressions([this.appSecrets, this.awsNativeAppSecrets], [{
        id: "AwsSolutions-SMG4",
        reason: "This provider-neutral JSON secret contains independent application encryption keyrings and non-provider secrets; rotation is performed by the versioned application-key workflow rather than one Secrets Manager database rotation schedule.",
      }]);
      for (const role of [this.executionRole, this.awsNativeExecutionRole]) {
        const executionPolicy = role.node.findChild("DefaultPolicy");
        NagSuppressions.addResourceSuppressions(executionPolicy, [{
          id: "AwsSolutions-IAM5",
          reason: "ECR authorization is not resource-scoped and CloudWatch Logs requires only the retained application log group's generated stream suffix.",
          appliesTo:["Resource::*","Resource::<AppLogGroup7D8CD952.Arn>:*"]
        }]);
      }
    }

    this.taskRole = new iam.Role(this, "TaskRole", {
      roleName: `tracepoint-${props.environmentName}-ecs-task`,
      assumedBy: ecsTasksPrincipal,
      description: "Least-privilege runtime role for the TracePoint application",
    });
    this.awsNativeTaskRole = new iam.Role(this, "AwsNativeTaskRole", {
      roleName: `tracepoint-${props.environmentName}-aws-native-ecs-task`,
      assumedBy: ecsTasksPrincipal,
      description: "Least-privilege AWS-native runtime role isolated from the retained bridge task",
    });

    new cdk.CfnOutput(this, "EcrRepositoryUri", { value: this.repository.repositoryUri });
    new cdk.CfnOutput(this, "EcsClusterName", { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, "ApplicationLogGroupName", { value: this.appLogGroup.logGroupName });
    new cdk.CfnOutput(this, "ApplicationSecretArn", { value: this.appSecrets.secretArn });
    new cdk.CfnOutput(this, "AwsNativeApplicationSecretArn", { value: this.awsNativeAppSecrets.secretArn });
    new cdk.CfnOutput(this, "TaskExecutionRoleArn", { value: this.executionRole.roleArn });
    new cdk.CfnOutput(this, "TaskRoleArn", { value: this.taskRole.roleArn });
    // Keep the legacy task-role cross-stack export during the staged provider
    // transition. The already-deployed storage stack imports it until that
    // stack is updated to the isolated AWS-native task role.
    this.exportValue(this.taskRole.roleArn);
    new cdk.CfnOutput(this, "AwsNativeTaskExecutionRoleArn", { value: this.awsNativeExecutionRole.roleArn });
    new cdk.CfnOutput(this, "AwsNativeTaskRoleArn", { value: this.awsNativeTaskRole.roleArn });
  }
}
