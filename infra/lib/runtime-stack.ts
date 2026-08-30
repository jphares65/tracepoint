import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
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
        minHealthyPercent: 100,
        circuitBreaker: { rollback: true },
        taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        assignPublicIp: true,
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
          },
          secrets: {
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

    service.targetGroup.configureHealthCheck({
      path: "/api/health",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
    });

    new cdk.CfnOutput(this, "LoadBalancerDnsName", {
      value: service.loadBalancer.loadBalancerDnsName,
    });
  }
}
