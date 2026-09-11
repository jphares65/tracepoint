import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface DatabaseBootstrapRunnerStackProps extends cdk.StackProps {
  environmentName: "staging";
  vpc: ec2.IVpc;
  databaseSecurityGroup: ec2.ISecurityGroup;
  repository: ecr.IRepository;
  logGroup: logs.ILogGroup;
  migratorSecret: secretsmanager.ISecret;
  runtimeSecret: secretsmanager.ISecret;
  sourceCommit: string;
  imageDigest: string;
}

export class DatabaseBootstrapRunnerStack extends cdk.Stack {
  readonly taskDefinition: ecs.FargateTaskDefinition;
  readonly runnerSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseBootstrapRunnerStackProps) {
    super(scope, id, props);
    if (this.account !== "559054714699" || this.region !== "us-east-1" ||
        !/^[0-9a-f]{40}$/.test(props.sourceCommit) ||
        !/^sha256:[0-9a-f]{64}$/.test(props.imageDigest)) {
      throw new Error("Exact staging account, region, source and immutable bootstrap image digest are required");
    }

    cdk.Tags.of(this).add("Purpose", "full-aws-database-bootstrap");
    cdk.Tags.of(this).add("DataClassification", "Synthetic-Non-PII");
    const databaseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "ImportedDatabaseSecurityGroup",
      props.databaseSecurityGroup.securityGroupId,
      { mutable: true },
    );

    this.runnerSecurityGroup = new ec2.SecurityGroup(this, "RunnerSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: false,
      description: "Temporary AWS-native schema bootstrap runner with no inbound access",
    });
    this.runnerSecurityGroup.addEgressRule(databaseSecurityGroup, ec2.Port.tcp(5432), "TLS PostgreSQL bootstrap");
    this.runnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "AWS control-plane access");
    databaseSecurityGroup.addIngressRule(this.runnerSecurityGroup, ec2.Port.tcp(5432), "Bounded schema bootstrap runner");

    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Pulls the immutable bootstrap image and injects only both database credentials",
    });
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Bootstrap process has no AWS API permissions",
    });
    props.repository.grantPull(executionRole);
    props.migratorSecret.grantRead(executionRole);
    props.runtimeSecret.grantRead(executionRole);
    props.logGroup.grantWrite(executionRole);

    this.taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDefinition", {
      family: "tracepoint-staging-database-bootstrap",
      cpu: 512,
      memoryLimitMiB: 1024,
      ephemeralStorageGiB: 21,
      executionRole,
      taskRole,
    });
    this.taskDefinition.addVolume({ name: "tmp" });
    const container = this.taskDefinition.addContainer("bootstrap", {
      image: ecs.ContainerImage.fromRegistry(`${props.repository.repositoryUri}@${props.imageDigest}`),
      entryPoint: ["node"],
      command: ["scripts/bootstrap-aws-postgres-target.mjs"],
      readonlyRootFilesystem: true,
      user: "node",
      logging: ecs.LogDrivers.awsLogs({ logGroup: props.logGroup, streamPrefix: "database-bootstrap" }),
      environment: {
        AWS_REGION: "us-east-1",
        TRACEPOINT_DATABASE_CA_PATH: "/app/rds-ca.pem",
      },
      secrets: {
        TRACEPOINT_MIGRATOR_SECRET_JSON: ecs.Secret.fromSecretsManager(props.migratorSecret),
        TRACEPOINT_RUNTIME_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(props.runtimeSecret),
      },
    });
    container.addMountPoints({ containerPath: "/tmp", sourceVolume: "tmp", readOnly: false });

    new cdk.CfnOutput(this, "TaskDefinitionArn", { value: this.taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, "RunnerSecurityGroupId", { value: this.runnerSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, "PublicSubnetIds", { value: props.vpc.publicSubnets.map(subnet => subnet.subnetId).join(",") });
  }
}
