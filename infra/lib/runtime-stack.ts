import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface RuntimeStackProps extends cdk.StackProps {
  environmentName: string;
  vpc: ec2.IVpc;
  repository: ecr.IRepository;
  cluster: ecs.ICluster;
  appLogGroup: logs.ILogGroup;
  appSecrets: secretsmanager.ISecret;
  executionRole: iam.IRole;
  taskRole: iam.IRole;
  certificateArn: string;
  imageTag: string;
}

export class RuntimeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RuntimeStackProps) {
    super(scope, id, props);

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "Certificate",
      props.certificateArn,
    );

    const taskSecurityGroup = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc: props.vpc,
      securityGroupName: `tracepoint-${props.environmentName}-task`,
      description: "TracePoint staging task egress: TLS providers and VPC DNS only",
      allowAllOutbound: false,
    });
    taskSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS providers");
    taskSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.udp(53),
      "VPC DNS over UDP",
    );
    taskSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(53),
      "VPC DNS over TCP",
    );

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "Service",
      {
        cluster: props.cluster,
        serviceName: `tracepoint-${props.environmentName}`,
        publicLoadBalancer: true,
        redirectHTTP: true,
        certificate,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        desiredCount: 1,
        cpu: 256,
        memoryLimitMiB: 512,
        minHealthyPercent: 100,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        circuitBreaker: { rollback: true },
        taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        assignPublicIp: true,
        securityGroups: [taskSecurityGroup],
        taskImageOptions: {
          image: ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag),
          containerName: "tracepoint",
          containerPort: 3000,
          executionRole: props.executionRole,
          taskRole: props.taskRole,
          logDriver: ecs.LogDrivers.awsLogs({
            logGroup: props.appLogGroup,
            streamPrefix: "web",
          }),
          environment: {
            NODE_ENV: "production",
            PORT: "3000",
            TRACEPOINT_DATA_PROVIDER: "supabase",
            TRACEPOINT_EMAIL_PROVIDER: "brevo",
            TRACEPOINT_STORAGE_PROVIDER: "supabase",
          },
          secrets: {
            CONFIGURATION_ENVIRONMENT: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "CONFIGURATION_ENVIRONMENT",
            ),
            NEXT_PUBLIC_SUPABASE_URL: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "NEXT_PUBLIC_SUPABASE_URL",
            ),
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
            ),
            NEXT_PUBLIC_SITE_URL: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "NEXT_PUBLIC_SITE_URL",
            ),
            SUPABASE_SECRET_KEY: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "SUPABASE_SECRET_KEY",
            ),
            BREVO_API_KEY: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "BREVO_API_KEY",
            ),
            NOTIFICATION_DISPATCH_SECRET: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "NOTIFICATION_DISPATCH_SECRET",
            ),
            NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
            ),
          },
        },
      },
    );

    const container = service.taskDefinition.defaultContainer;
    if (!container) { throw new Error("TracePoint runtime requires a default container"); }
    service.taskDefinition.addVolume({ name: "runtime-cache" });
    service.taskDefinition.addVolume({ name: "temporary-files" });
    container.addMountPoints(
      { sourceVolume: "runtime-cache", containerPath: "/app/.next/cache", readOnly: false },
      { sourceVolume: "temporary-files", containerPath: "/tmp", readOnly: false },
    );
    const cfnTaskDefinition = service.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition;
    cfnTaskDefinition.addPropertyOverride("ContainerDefinitions.0.ReadonlyRootFilesystem", true);
    cfnTaskDefinition.addPropertyOverride("ContainerDefinitions.0.StopTimeout", 30);
    cfnTaskDefinition.addPropertyOverride("ContainerDefinitions.0.User", "65532:65532");
    cfnTaskDefinition.addPropertyOverride(
      "ContainerDefinitions.0.LinuxParameters.InitProcessEnabled",
      true,
    );

    service.targetGroup.configureHealthCheck({
      path: "/api/health",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
    });

    const errorRate = new cloudwatch.MathExpression({
      expression: "IF(requests > 0, errors * 100 / requests, 0)",
      label: "ALB 5xx rate (%)",
      period: cdk.Duration.minutes(1),
      usingMetrics: {
        errors: service.loadBalancer.metrics.httpCodeElb(
          elbv2.HttpCodeElb.ELB_5XX_COUNT,
          { statistic: "sum", period: cdk.Duration.minutes(1) },
        ),
        requests: service.loadBalancer.metrics.requestCount({
          statistic: "sum",
          period: cdk.Duration.minutes(1),
        }),
      },
    });
    new cloudwatch.Alarm(this, "Alb5xxRateAlarm", {
      alarmName: `tracepoint-${props.environmentName}-alb-5xx-rate`,
      alarmDescription: "TracePoint staging ALB 5xx rate exceeds five percent",
      metric: errorRate,
      threshold: 5,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, "UnhealthyTargetAlarm", {
      alarmName: `tracepoint-${props.environmentName}-unhealthy-target`,
      alarmDescription: "TracePoint staging has an unhealthy application target",
      metric: service.targetGroup.metrics.unhealthyHostCount({
        statistic: "maximum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    new cdk.CfnOutput(this, "LoadBalancerDnsName", {
      value: service.loadBalancer.loadBalancerDnsName,
    });
  }
}
