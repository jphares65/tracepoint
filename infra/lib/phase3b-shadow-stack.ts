import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

// These are reviewed Phase 3B identities, not configurable fallbacks.
const account = '193644343389';
const region = 'us-east-1';
const origin = 'https://shadow.tracepointhq.com';
const hostname = 'shadow.tracepointhq.com';
const accessCidr = '76.116.100.225/32';
const imageDigest = 'sha256:112f40c6879e7ae6eb18a8cf3a5f143a2c2935ac99a16be36316a047916ab345';
const vpcId = 'vpc-04accb4047a914176';
const subnetId = 'subnet-0f4cbed3e60d90bfc';
const albSecurityGroupId = 'sg-0a7ba07ccc254d6b6';
const rdsSecurityGroupId = 'sg-096e4787eae992cf4';
const listenerArn = `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/tracep-Servi-HFH2HwVNXfys/95b1a0c4cb1f514d/068663ecd22df15a`;
const clusterArn = `arn:aws:ecs:${region}:${account}:cluster/tracepoint-production`;
const applicationSecretArn = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/application/aws-native-rIikku`;
const shadowDatabaseSecretArn = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/shadow/database-runtime-jNRvgT`;
const kmsKeyArn = `arn:aws:kms:${region}:${account}:key/4dc71990-3cfa-49d7-88c6-383bc1067f55`;
const bucketName = `tracepoint-production-private-${account}`;
const testDepartmentId = 'd44d06e0-5010-48ce-ab94-944b9016ab3b';

export class Phase3bShadowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    if (this.account !== account || this.region !== region) throw new Error('Unexpected AWS account or region.');

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId,
      vpcCidrBlock: '10.40.0.0/16',
      availabilityZones: ['us-east-1a'],
      publicSubnetIds: [subnetId],
    });
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'AlbSecurityGroup', albSecurityGroupId, {
      mutable: true, allowAllOutbound: false,
    });
    const rdsSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'RdsSecurityGroup', rdsSecurityGroupId, { mutable: true });
    const taskSg = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc, description: 'Phase 3B shadow runtime only', allowAllOutbound: false,
    });
    taskSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'Only the existing ALB may reach the shadow task');
    albSg.addEgressRule(taskSg, ec2.Port.tcp(3000), 'Existing ALB to Phase 3B shadow task only');
    taskSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'AWS API/OIDC HTTPS');
    taskSg.addEgressRule(ec2.Peer.ipv4('10.40.0.0/16'), ec2.Port.udp(53), 'VPC DNS UDP');
    taskSg.addEgressRule(ec2.Peer.ipv4('10.40.0.0/16'), ec2.Port.tcp(53), 'VPC DNS TCP');
    taskSg.addEgressRule(rdsSg, ec2.Port.tcp(5432), 'Pinned quarantined RDS PostgreSQL');
    rdsSg.addIngressRule(taskSg, ec2.Port.tcp(5432), 'Phase 3B shadow task only');

    // Adopt the retained, independently stored shadow-only secret; never reference the live runtime secret.

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECR pull, logs, and only Phase 3B shadow/app secret injection',
    });
    executionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [shadowDatabaseSecretArn, applicationSecretArn],
    }));
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'], resources: [kmsKeyArn],
      conditions: { StringEquals: { 'kms:ViaService': `secretsmanager.${region}.amazonaws.com` } },
    }));

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Only test-department S3 objects; no Cognito mutation or Supabase access',
    });
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [
        `arn:aws:s3:::${bucketName}/attachments/${testDepartmentId}/*`,
        `arn:aws:s3:::${bucketName}/department-assets/${testDepartmentId}/*`,
      ],
    }));

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/tracepoint-production-phase3b-shadow',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const appSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'ApplicationSecret', applicationSecretArn);
    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', shadowDatabaseSecretArn);
    const userPoolClient = new cognito.CfnUserPoolClient(this, 'ShadowCognitoClient', {
      userPoolId: 'us-east-1_diFmWDMe9',
      clientName: 'tracepoint-phase3b-shadow',
      generateSecret: false,
      allowedOAuthFlowsUserPoolClient: true,
      allowedOAuthFlows: ['code'],
      allowedOAuthScopes: ['openid', 'email', 'profile'],
      callbackUrLs: [`${origin}/api/auth/cognito/callback`],
      logoutUrLs: [`${origin}/login`],
      supportedIdentityProviders: ['COGNITO'],
      preventUserExistenceErrors: 'ENABLED',
    });
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: 'tracepoint-production-phase3b-shadow', cpu: 512, memoryLimitMiB: 1024,
      executionRole, taskRole,
    });
    const container = taskDefinition.addContainer('tracepoint', {
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, 'ImageRepository', 'tracepoint-production'), imageDigest,
      ),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'web' }),
      environment: {
        NODE_ENV: 'production', PORT: '3000',
        NEXT_PUBLIC_SITE_URL: origin,
        TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native',
        TRACEPOINT_DATA_PROVIDER: 'postgres',
        TRACEPOINT_AUTH_PROVIDER: 'cognito',
        TRACEPOINT_EMAIL_PROVIDER: 'ses',
        TRACEPOINT_STORAGE_PROVIDER: 's3',
        TRACEPOINT_NOTIFICATION_MODE: 'shadow',
        TRACEPOINT_DATABASE_CA_PATH: '/app/rds-ca.pem',
        TRACEPOINT_COGNITO_USER_POOL_ID: 'us-east-1_diFmWDMe9',
        TRACEPOINT_COGNITO_CLIENT_ID: userPoolClient.ref,
        TRACEPOINT_S3_BUCKET: bucketName,
        TRACEPOINT_S3_EXPECTED_OWNER: account,
        TRACEPOINT_AWS_ACCOUNT_ID: account,
        AWS_REGION: region,
      },
      secrets: {
        CONFIGURATION_ENVIRONMENT: ecs.Secret.fromSecretsManager(appSecret, 'CONFIGURATION_ENVIRONMENT'),
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecret, 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'),
        TRACEPOINT_AUTH_STATE_KEYS: ecs.Secret.fromSecretsManager(appSecret, 'TRACEPOINT_AUTH_STATE_KEYS'),
        TRACEPOINT_AUTH_REFRESH_KEYS: ecs.Secret.fromSecretsManager(appSecret, 'TRACEPOINT_AUTH_REFRESH_KEYS'),
        TRACEPOINT_IMPORT_APPROVAL_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'TRACEPOINT_IMPORT_APPROVAL_SECRET'),
        NOTIFICATION_DISPATCH_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'NOTIFICATION_DISPATCH_SECRET'),
        TRACEPOINT_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(dbSecret),
      },
      readonlyRootFilesystem: true,
      user: '65532:65532',
      stopTimeout: cdk.Duration.seconds(30),
    });
    container.addPortMappings({ containerPort: 3000 });
    taskDefinition.addVolume({ name: 'runtime-cache' });
    taskDefinition.addVolume({ name: 'temporary-files' });
    container.addMountPoints(
      { sourceVolume: 'runtime-cache', containerPath: '/app/.next/cache', readOnly: false },
      { sourceVolume: 'temporary-files', containerPath: '/tmp', readOnly: false },
    );
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterName: 'tracepoint-production', clusterArn, vpc,
    });
    const service = new ecs.FargateService(this, 'Service', {
      cluster, serviceName: 'tracepoint-production-phase3b-shadow', taskDefinition,
      desiredCount: 1, assignPublicIp: true,
      minHealthyPercent: 100,
      vpcSubnets: { subnets: [ec2.Subnet.fromSubnetId(this, 'TaskSubnet', subnetId)] },
      securityGroups: [taskSg],
      circuitBreaker: { rollback: true },
    });
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc, targetType: elbv2.TargetType.IP, port: 3000, protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: { path: '/api/health', healthyHttpCodes: '200', interval: cdk.Duration.seconds(30) },
    });
    service.attachToApplicationTargetGroup(targetGroup);
    new elbv2.CfnListenerRule(this, 'AllowedShadowRule', {
      listenerArn, priority: 10,
      conditions: [
        { field: 'host-header', hostHeaderConfig: { values: [hostname] } },
        { field: 'source-ip', sourceIpConfig: { values: [accessCidr] } },
      ],
      actions: [{ type: 'forward', targetGroupArn: targetGroup.targetGroupArn }],
    });
    new elbv2.CfnListenerRule(this, 'DeniedShadowRule', {
      listenerArn, priority: 11,
      conditions: [{ field: 'host-header', hostHeaderConfig: { values: [hostname] } }],
      actions: [{ type: 'fixed-response', fixedResponseConfig: { statusCode: '403', contentType: 'text/plain', messageBody: 'Forbidden' } }],
    });
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: 'Z06725946QWMQBKB1JT8', zoneName: 'tracepointhq.com',
    });
    new route53.ARecord(this, 'ShadowDns', {
      zone: hostedZone, recordName: 'shadow',
      target: route53.RecordTarget.fromAlias({
        bind: () => ({ dnsName: 'tracep-Servi-HFH2HwVNXfys-2100776525.us-east-1.elb.amazonaws.com',
          hostedZoneId: 'Z35SXDOTRQ7X7K' }),
      }),
    });
    new cdk.CfnOutput(this, 'ShadowTaskDefinitionArn', { value: taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'ShadowServiceName', { value: service.serviceName });
    new cdk.CfnOutput(this, 'ShadowDatabaseSecretArn', { value: shadowDatabaseSecretArn });
    new cdk.CfnOutput(this, 'ShadowCognitoClientId', { value: userPoolClient.ref });
    new cdk.CfnOutput(this, 'ShadowAccessCidr', { value: accessCidr });
    new cdk.CfnOutput(this, 'ShadowTestDepartmentId', { value: testDepartmentId });
  }
}
