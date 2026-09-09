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
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NagSuppressions } from "cdk-nag";
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
  emailFromAddress?: string;
  storageBucketName?: string;
  desiredCount?: number;
  maxCapacity?: number;
  deletionProtection?: boolean;
  productionControls?: boolean;
  providerMode?: "bridge" | "aws-native";
  databaseSecret?: secretsmanager.ISecret;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  sesConfigurationSet?: string;
}

export class RuntimeStack extends cdk.Stack {
  public readonly loadBalancerArn: string;

  constructor(scope: Construct, id: string, props: RuntimeStackProps) {
    super(scope, id, props);

    const providerMode = props.providerMode ?? "bridge";
    const awsNative = providerMode === "aws-native";
    const emailFromAddress = props.emailFromAddress ?? (props.environmentName === "staging" ? "contact@tracepointhq.com" : undefined);
    if (emailFromAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFromAddress)) throw new Error("Invalid email sender address");
    if (awsNative && (!props.storageBucketName || !props.databaseSecret || !emailFromAddress ||
      !/^us-east-1_[A-Za-z0-9]+$/.test(props.cognitoUserPoolId ?? "") ||
      !/^[A-Za-z0-9]{1,128}$/.test(props.cognitoClientId ?? "") ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(props.sesConfigurationSet ?? ""))) {
      throw new Error("Full-AWS runtime requires explicit PostgreSQL, Cognito, S3, and SES targets");
    }
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "Certificate",
      props.certificateArn,
    );

    const taskSecurityGroup = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc: props.vpc,
      securityGroupName: `tracepoint-${props.environmentName}-task`,
      description: `TracePoint ${props.environmentName} task egress: TLS providers and VPC DNS only`,
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

    const providerEnvironment: Record<string, string> = awsNative ? {
      TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
      TRACEPOINT_DATA_PROVIDER: "postgres",
      TRACEPOINT_AUTH_PROVIDER: "cognito",
      TRACEPOINT_EMAIL_PROVIDER: "ses",
      TRACEPOINT_STORAGE_PROVIDER: "s3",
      TRACEPOINT_S3_BUCKET: props.storageBucketName!,
      TRACEPOINT_S3_EXPECTED_OWNER: this.account,
      TRACEPOINT_DATABASE_CA_PATH: "/app/rds-ca.pem",
      TRACEPOINT_COGNITO_USER_POOL_ID: props.cognitoUserPoolId!,
      TRACEPOINT_COGNITO_CLIENT_ID: props.cognitoClientId!,
      TRACEPOINT_AWS_ACCOUNT_ID: this.account,
      TRACEPOINT_SES_CONFIGURATION_SET: props.sesConfigurationSet!,
      AWS_REGION: this.region,
    } : {
      TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge",
      TRACEPOINT_DATA_PROVIDER: "supabase",
      TRACEPOINT_AUTH_PROVIDER: "supabase",
      TRACEPOINT_EMAIL_PROVIDER: "brevo",
      TRACEPOINT_STORAGE_PROVIDER: props.storageBucketName ? "s3" : "supabase",
      ...(props.storageBucketName ? { TRACEPOINT_S3_BUCKET:props.storageBucketName, TRACEPOINT_S3_EXPECTED_OWNER:this.account, AWS_REGION:this.region } : {}),
    };
    const providerSecrets: Record<string, ecs.Secret> = awsNative ? {
      TRACEPOINT_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(props.databaseSecret!),
      TRACEPOINT_IMPORT_APPROVAL_SECRET: ecs.Secret.fromSecretsManager(props.appSecrets, "TRACEPOINT_IMPORT_APPROVAL_SECRET"),
      TRACEPOINT_AUTH_STATE_KEYS: ecs.Secret.fromSecretsManager(props.appSecrets, "TRACEPOINT_AUTH_STATE_KEYS"),
      TRACEPOINT_AUTH_REFRESH_KEYS: ecs.Secret.fromSecretsManager(props.appSecrets, "TRACEPOINT_AUTH_REFRESH_KEYS"),
    } : {
      NEXT_PUBLIC_SUPABASE_URL: ecs.Secret.fromSecretsManager(props.appSecrets, "NEXT_PUBLIC_SUPABASE_URL"),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ecs.Secret.fromSecretsManager(props.appSecrets, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      SUPABASE_SECRET_KEY: ecs.Secret.fromSecretsManager(props.appSecrets, "SUPABASE_SECRET_KEY"),
      SUPABASE_SERVICE_ROLE_KEY: ecs.Secret.fromSecretsManager(props.appSecrets, "SUPABASE_SECRET_KEY"),
      BREVO_API_KEY: ecs.Secret.fromSecretsManager(props.appSecrets, "BREVO_API_KEY"),
    };
    if (awsNative) props.databaseSecret!.grantRead(props.executionRole);

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
        desiredCount: props.desiredCount ?? 1,
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
            ...(emailFromAddress ? { TRACEPOINT_FROM_EMAIL: emailFromAddress } : {}),
            ...providerEnvironment,
          },
          secrets: {
            CONFIGURATION_ENVIRONMENT: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "CONFIGURATION_ENVIRONMENT",
            ),
            NEXT_PUBLIC_SITE_URL: ecs.Secret.fromSecretsManager(
              props.appSecrets,
              "NEXT_PUBLIC_SITE_URL",
            ),
            ...providerSecrets,
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
    this.loadBalancerArn = service.loadBalancer.loadBalancerArn;
    if (props.productionControls) {
      const accessLogs = new s3.Bucket(this, "AlbAccessLogs", {
        bucketName: `tracepoint-${props.environmentName}-alb-access-${this.account}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        lifecycleRules: [{id:"expire-alb-access-logs",expiration:cdk.Duration.days(90)}],
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });
      NagSuppressions.addResourceSuppressions(accessLogs, [{
        id: "AwsSolutions-S1",
        reason: "This dedicated bucket is the terminal ALB-access-log destination; recursive access logging is neither useful nor supported.",
      }]);
      service.loadBalancer.logAccessLogs(accessLogs,"alb");
      NagSuppressions.addResourceSuppressions(service.loadBalancer, [{
        id: "AwsSolutions-ELB2",
        reason: "ALB access logging is configured by this stack to a retained, TLS-only production bucket.",
      }]);
      NagSuppressions.addResourceSuppressions(service.loadBalancer.connections.securityGroups[0], [{
        id: "AwsSolutions-EC23",
        reason: "The public production ALB intentionally accepts only HTTP redirect and HTTPS listener ports; WAF enforcement is associated in the request-controls stack.",
      }]);
    }

    if (props.deletionProtection) service.loadBalancer.setAttribute("deletion_protection.enabled", "true");
    if (props.maxCapacity) {
      const scaling = service.service.autoScaleTaskCount({ minCapacity: props.desiredCount ?? 1, maxCapacity: props.maxCapacity });
      scaling.scaleOnCpuUtilization("CpuScaling", { targetUtilizationPercent: 60 });
    }
    new cloudwatch.Alarm(this, "Application5xxAlarm", {
      alarmName: `tracepoint-${props.environmentName}-application-5xx`,
      metric: service.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        statistic: "sum", period: cdk.Duration.minutes(1),
      }),
      threshold: 5, evaluationPeriods: 3, datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, "MemoryAlarm", {
      alarmName: `tracepoint-${props.environmentName}-memory`,
      metric: service.service.metricMemoryUtilization({ period: cdk.Duration.minutes(1) }),
      threshold: 85, evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    // Retain prior ACTIVE definitions so the rollback command has a usable target.
    service.taskDefinition.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    const container = service.taskDefinition.defaultContainer;
    if (!container) { throw new Error("TracePoint runtime requires a default container"); }
    service.taskDefinition.addVolume({ name: "runtime-cache" });
    service.taskDefinition.addVolume({ name: "temporary-files" });
    container.addMountPoints(
      { sourceVolume: "runtime-cache", containerPath: "/app/.next/cache", readOnly: false },
      { sourceVolume: "temporary-files", containerPath: "/tmp", readOnly: false },
    );
    const cfnTaskDefinition = service.taskDefinition.node.defaultChild as ecs.CfnTaskDefinition;
    if (props.productionControls) NagSuppressions.addResourceSuppressions(cfnTaskDefinition, [{
      id: "AwsSolutions-ECS2",
      reason: "Direct task variables are non-secret provider selectors, port, region, and bucket metadata; every credential and encryption key is injected from Secrets Manager.",
    }]);
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
      alarmDescription: `TracePoint ${props.environmentName} ALB 5xx rate exceeds five percent`,
      metric: errorRate,
      threshold: 5,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, "UnhealthyTargetAlarm", {
      alarmName: `tracepoint-${props.environmentName}-unhealthy-target`,
      alarmDescription: `TracePoint ${props.environmentName} has an unhealthy application target`,
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

    if (props.productionControls) {
      new cloudwatch.Alarm(this, "CpuAlarm", {
        alarmName: `tracepoint-${props.environmentName}-cpu`,
        alarmDescription: `TracePoint ${props.environmentName} CPU remains above 85 percent`,
        metric: service.service.metricCpuUtilization({ period: cdk.Duration.minutes(1) }),
        threshold: 85,
        evaluationPeriods: 3,
        datapointsToAlarm: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      new cloudwatch.Alarm(this, "LatencyP99Alarm", {
        alarmName: `tracepoint-${props.environmentName}-latency-p99`,
        alarmDescription: `TracePoint ${props.environmentName} target p99 latency exceeds three seconds`,
        metric: service.targetGroup.metrics.targetResponseTime({ statistic: "p99", period: cdk.Duration.minutes(1) }),
        threshold: 3,
        evaluationPeriods: 3,
        datapointsToAlarm: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }

    new cdk.CfnOutput(this, "LoadBalancerDnsName", {
      value: service.loadBalancer.loadBalancerDnsName,
    });
  }
}
