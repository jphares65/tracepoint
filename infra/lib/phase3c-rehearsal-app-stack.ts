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

const account = '193644343389';
const region = 'us-east-1';
const hostname = 'shadow-rehearsal.tracepointhq.com';
const origin = `https://${hostname}`;
const databaseHost = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const databaseSecretName = 'tracepoint/production/rehearsal/database-runtime-4272874f';
const sourceCredentialArn = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/shadow/database-runtime-jNRvgT`;
const migrationCredentialArn = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/database/migrator-8X57JT`;
const applicationSecretArn = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/application/aws-native-rIikku`;
const kmsKeyArn = `arn:aws:kms:${region}:${account}:key/4dc71990-3cfa-49d7-88c6-383bc1067f55`;
const bucketName = `tracepoint-production-private-${account}`;
const patchKeys = [
  'department-assets/1d0e2994-4224-4237-8328-71020ba20027/patch-1787431778595.jpg',
  'department-assets/d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0/patch-1782439034425.png',
];
const accessCidrs = ['76.116.100.225/32', '50.174.33.3/32'];

export interface Phase3cRehearsalAppProps extends cdk.StackProps { imageDigest: string; activate?: boolean }

export class Phase3cRehearsalAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Phase3cRehearsalAppProps) {
    super(scope, id, props);
    if (this.account !== account || this.region !== region ||
        !/^sha256:[0-9a-f]{64}$/.test(props.imageDigest)) throw new Error('Exact rehearsal account, region, and immutable image are required.');

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: 'vpc-04accb4047a914176', vpcCidrBlock: '10.40.0.0/16',
      availabilityZones: ['us-east-1a'], publicSubnetIds: ['subnet-0f4cbed3e60d90bfc'],
    });
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'AlbSecurityGroup', 'sg-0a7ba07ccc254d6b6', { mutable: true, allowAllOutbound: false });
    const rdsSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'RehearsalRdsSecurityGroup', 'sg-096e4787eae992cf4', { mutable: true });
    const taskSg = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc, description: 'Only the isolated Phase 3C rehearsal application', allowAllOutbound: false,
    });
    taskSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'Existing ALB to isolated rehearsal application');
    albSg.addEgressRule(taskSg, ec2.Port.tcp(3000), 'Existing ALB to isolated rehearsal application only');
    taskSg.addEgressRule(rdsSg, ec2.Port.tcp(5432), 'Attested rehearsal RDS only');
    rdsSg.addIngressRule(taskSg, ec2.Port.tcp(5432), 'Isolated rehearsal application only');
    taskSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Cognito and AWS APIs over HTTPS');
    taskSg.addEgressRule(ec2.Peer.ipv4('10.40.0.0/16'), ec2.Port.udp(53), 'VPC DNS UDP');
    taskSg.addEgressRule(ec2.Peer.ipv4('10.40.0.0/16'), ec2.Port.tcp(53), 'VPC DNS TCP');

    // The application receives this independent secret, never the Phase 3B or public database secret.
    // The shared snapshot role credential is copied at stack creation by CloudFormation dynamic
    // reference; the credential itself is absent from templates, logs, and task definitions.
    const dbSecret = new secretsmanager.CfnSecret(this, 'RehearsalDatabaseSecret', {
      name: databaseSecretName, kmsKeyId: kmsKeyArn,
      secretString: JSON.stringify({ host: databaseHost, port: 5432, username: 'tracepoint_runtime',
        password: `{{resolve:secretsmanager:${sourceCredentialArn}:SecretString:password}}`, dbname: 'tracepoint' }),
      description: 'Isolated Phase 3C rehearsal application database endpoint; never inject into public or Phase 3B tasks',
    });
    dbSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    // A separate one-shot task receives only this rehearsal-pinned migrator secret.
    // The web service never receives it, and neither source secret is injected into a task.
    const fixtureSecret = new secretsmanager.CfnSecret(this, 'RehearsalFixtureDatabaseSecret', {
      name: 'tracepoint/production/rehearsal/database-fixture-4272874f', kmsKeyId: kmsKeyArn,
      secretString: JSON.stringify({ host: databaseHost, port: 5432, username: 'tracepoint_migrator',
        password: `{{resolve:secretsmanager:${migrationCredentialArn}:SecretString:password}}`, dbname: 'tracepoint' }),
      description: 'One-shot fixed synthetic auth fixture for the attested Phase 3C rehearsal database only',
    });
    fixtureSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: 'TracePoint-Phase3cRehearsalAppExec', assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    executionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
    executionRole.addToPolicy(new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [dbSecret.ref, applicationSecretArn] }));
    executionRole.addToPolicy(new iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: [kmsKeyArn],
      conditions: { StringEquals: { 'kms:ViaService': `secretsmanager.${region}.amazonaws.com` } } }));
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: 'TracePoint-Phase3cRehearsalAppTask', assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Read only the two attested rehearsal patch objects; no S3 write, Cognito mutation, SES, or Supabase access',
    });
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'],
      resources: patchKeys.map(key => `arn:aws:s3:::${bucketName}/${key}`) }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: [kmsKeyArn],
      conditions: { StringEquals: { 'kms:ViaService': `s3.${region}.amazonaws.com` } } }));

    const fixtureExecutionRole = new iam.Role(this, 'FixtureExecutionRole', {
      roleName: 'TracePoint-Phase3cRehearsalFixtureExec', assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    fixtureExecutionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
    fixtureExecutionRole.addToPolicy(new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [fixtureSecret.ref] }));
    fixtureExecutionRole.addToPolicy(new iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: [kmsKeyArn],
      conditions: { StringEquals: { 'kms:ViaService': `secretsmanager.${region}.amazonaws.com` } } }));
    const fixtureTaskRole = new iam.Role(this, 'FixtureTaskRole', {
      roleName: 'TracePoint-Phase3cRehearsalFixtureTask', assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'No AWS API permissions; the fixed fixture uses only TLS PostgreSQL',
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/tracepoint-production-phase3c-rehearsal-app',
      retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Retain the earlier client on the shared pool unchanged. The rehearsal
    // runtime below uses only the dedicated pool/client and cannot accept
    // tokens issued by the shared pool.
    new cognito.CfnUserPoolClient(this, 'RehearsalCognitoClient', {
      userPoolId: 'us-east-1_diFmWDMe9', clientName: 'tracepoint-phase3c-rehearsal-only', generateSecret: false,
      allowedOAuthFlowsUserPoolClient: true, allowedOAuthFlows: ['code'], allowedOAuthScopes: ['openid', 'email', 'profile'],
      callbackUrLs: [`${origin}/api/auth/cognito/callback`], logoutUrLs: [`${origin}/login`],
      supportedIdentityProviders: ['COGNITO'], preventUserExistenceErrors: 'ENABLED',
      idTokenValidity: 15, accessTokenValidity: 15,
      tokenValidityUnits: { idToken: 'minutes', accessToken: 'minutes' },
    });
    const rehearsalPool = new cognito.CfnUserPool(this, 'DedicatedRehearsalUserPool', {
      userPoolName: 'tracepoint-phase3c-rehearsal-only',
      userPoolTier: 'ESSENTIALS',
      deletionProtection: 'ACTIVE',
      usernameAttributes: ['email'],
      autoVerifiedAttributes: ['email'],
      adminCreateUserConfig: { allowAdminCreateUserOnly: true },
      accountRecoverySetting: { recoveryMechanisms: [{ name: 'verified_email', priority: 1 }] },
      policies: { passwordPolicy: { minimumLength: 14, requireLowercase: true, requireUppercase: true,
        requireNumbers: true, requireSymbols: true, temporaryPasswordValidityDays: 1 } },
      mfaConfiguration: 'ON',
      enabledMfas: ['SOFTWARE_TOKEN_MFA'],
    });
    rehearsalPool.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    new cognito.CfnUserPoolDomain(this, 'DedicatedRehearsalUserPoolDomain', {
      domain: 'tracepoint-phase3c-rehearsal-193644343389',
      userPoolId: rehearsalPool.ref,
      managedLoginVersion: 1,
    });
    const client = new cognito.CfnUserPoolClient(this, 'DedicatedRehearsalCognitoClient', {
      userPoolId: rehearsalPool.ref, clientName: 'tracepoint-phase3c-dedicated-rehearsal', generateSecret: false,
      allowedOAuthFlowsUserPoolClient: true, allowedOAuthFlows: ['code'],
      allowedOAuthScopes: ['openid', 'email', 'profile'],
      callbackUrLs: [`${origin}/api/auth/cognito/callback`], logoutUrLs: [`${origin}/login`],
      supportedIdentityProviders: ['COGNITO'], preventUserExistenceErrors: 'ENABLED',
      idTokenValidity: 15, accessTokenValidity: 15, refreshTokenValidity: 1,
      tokenValidityUnits: { idToken: 'minutes', accessToken: 'minutes', refreshToken: 'days' },
      refreshTokenRotation: { feature: 'ENABLED', retryGracePeriodSeconds: 0 },
      enableTokenRevocation: true,
    });
    const appSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'ApplicationSecret', applicationSecretArn);
    const runtimeDbSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', dbSecret.ref);
    const task = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: 'tracepoint-production-phase3c-rehearsal-app', cpu: 512, memoryLimitMiB: 1024,
      executionRole, taskRole,
    });
    const container = task.addContainer('tracepoint', {
      image: ecs.ContainerImage.fromEcrRepository(ecr.Repository.fromRepositoryName(this, 'ImageRepository', 'tracepoint-production'), props.imageDigest),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'web' }),
      environment: {
        NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0', NEXT_PUBLIC_SITE_URL: origin,
        TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native', TRACEPOINT_DATA_PROVIDER: 'postgres',
        TRACEPOINT_AUTH_PROVIDER: 'cognito', TRACEPOINT_EMAIL_PROVIDER: 'ses', TRACEPOINT_STORAGE_PROVIDER: 's3',
        TRACEPOINT_NOTIFICATION_MODE: 'shadow', TRACEPOINT_REHEARSAL_APP_MODE: 'object-smoke',
        TRACEPOINT_DATABASE_CA_PATH: '/app/rds-ca.pem', TRACEPOINT_COGNITO_USER_POOL_ID: rehearsalPool.ref,
        TRACEPOINT_COGNITO_CLIENT_ID: client.ref, TRACEPOINT_S3_BUCKET: bucketName,
        TRACEPOINT_S3_EXPECTED_OWNER: account, TRACEPOINT_AWS_ACCOUNT_ID: account, AWS_REGION: region,
      },
      secrets: {
        CONFIGURATION_ENVIRONMENT: ecs.Secret.fromSecretsManager(appSecret, 'CONFIGURATION_ENVIRONMENT'),
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecret, 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'),
        TRACEPOINT_AUTH_STATE_KEYS: ecs.Secret.fromSecretsManager(appSecret, 'TRACEPOINT_AUTH_STATE_KEYS'),
        TRACEPOINT_AUTH_REFRESH_KEYS: ecs.Secret.fromSecretsManager(appSecret, 'TRACEPOINT_AUTH_REFRESH_KEYS'),
        TRACEPOINT_IMPORT_APPROVAL_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'TRACEPOINT_IMPORT_APPROVAL_SECRET'),
        NOTIFICATION_DISPATCH_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'NOTIFICATION_DISPATCH_SECRET'),
        TRACEPOINT_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(runtimeDbSecret),
      },
      readonlyRootFilesystem: true, user: '65532:65532', stopTimeout: cdk.Duration.seconds(30),
    });
    container.addPortMappings({ containerPort: 3000 });
    task.addVolume({ name: 'runtime-cache' });
    task.addVolume({ name: 'temporary-files' });
    container.addMountPoints(
      { sourceVolume: 'runtime-cache', containerPath: '/app/.next/cache', readOnly: false },
      { sourceVolume: 'temporary-files', containerPath: '/tmp', readOnly: false },
    );
    const fixtureTask = new ecs.FargateTaskDefinition(this, 'FixtureTaskDefinition', {
      family: 'tracepoint-production-phase3c-rehearsal-fixture', cpu: 256, memoryLimitMiB: 512,
      executionRole: fixtureExecutionRole, taskRole: fixtureTaskRole,
    });
    fixtureTask.addContainer('fixture', {
      image: ecs.ContainerImage.fromEcrRepository(ecr.Repository.fromRepositoryName(this, 'FixtureImageRepository', 'tracepoint-production'), props.imageDigest),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'fixture' }),
      command: ['/app/phase3c-rehearsal-auth-fixture.cjs', 'create'],
      environment: { TRACEPOINT_DATABASE_CA_PATH: '/app/rds-ca.pem', TRACEPOINT_COGNITO_USER_POOL_ID: rehearsalPool.ref },
      secrets: { TRACEPOINT_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(
        secretsmanager.Secret.fromSecretCompleteArn(this, 'FixtureDatabaseSecret', fixtureSecret.ref)) },
      readonlyRootFilesystem: true, user: '65532:65532',
    });

    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterName: 'tracepoint-production', clusterArn: `arn:aws:ecs:${region}:${account}:cluster/tracepoint-production`, vpc,
    });
    const service = new ecs.FargateService(this, 'Service', {
      cluster, serviceName: 'tracepoint-production-phase3c-rehearsal-app', taskDefinition: task,
      // The first deployment only provisions infrastructure and independent secrets.
      // Activate one task only after control-plane and secret attestation.
      desiredCount: props.activate === true ? 1 : 0, assignPublicIp: true, minHealthyPercent: 100,
      vpcSubnets: { subnets: [ec2.Subnet.fromSubnetId(this, 'TaskSubnet', 'subnet-0f4cbed3e60d90bfc')] },
      securityGroups: [taskSg], circuitBreaker: { rollback: true },
    });
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc, targetType: elbv2.TargetType.IP, port: 3000, protocol: elbv2.ApplicationProtocol.HTTP,
      healthCheck: { path: '/api/health', healthyHttpCodes: '200', interval: cdk.Duration.seconds(30) },
    });
    service.attachToApplicationTargetGroup(targetGroup);
    const listenerArn = `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/tracep-Servi-HFH2HwVNXfys/95b1a0c4cb1f514d/068663ecd22df15a`;
    new elbv2.CfnListenerRule(this, 'AllowedRehearsalRule', {
      listenerArn, priority: 12,
      conditions: [{ field: 'host-header', hostHeaderConfig: { values: [hostname] } },
        { field: 'source-ip', sourceIpConfig: { values: accessCidrs } }],
      actions: [{ type: 'forward', targetGroupArn: targetGroup.targetGroupArn }],
    });
    new elbv2.CfnListenerRule(this, 'DeniedRehearsalRule', {
      listenerArn, priority: 13,
      conditions: [{ field: 'host-header', hostHeaderConfig: { values: [hostname] } }],
      actions: [{ type: 'fixed-response', fixedResponseConfig: { statusCode: '403', contentType: 'text/plain', messageBody: 'Forbidden' } }],
    });
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: 'Z06725946QWMQBKB1JT8', zoneName: 'tracepointhq.com',
    });
    new route53.ARecord(this, 'RehearsalDns', {
      zone, recordName: 'shadow-rehearsal',
      target: route53.RecordTarget.fromAlias({ bind: () => ({
        dnsName: 'tracep-Servi-HFH2HwVNXfys-2100776525.us-east-1.elb.amazonaws.com',
        hostedZoneId: 'Z35SXDOTRQ7X7K',
      }) }),
    });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName });
    new cdk.CfnOutput(this, 'TaskDefinitionArn', { value: task.taskDefinitionArn });
    new cdk.CfnOutput(this, 'FixtureTaskDefinitionArn', { value: fixtureTask.taskDefinitionArn });
    new cdk.CfnOutput(this, 'RehearsalDatabaseSecretArn', { value: dbSecret.ref });
    new cdk.CfnOutput(this, 'RehearsalCognitoClientId', { value: client.ref });
    new cdk.CfnOutput(this, 'DedicatedRehearsalUserPoolId', { value: rehearsalPool.ref });
    new cdk.CfnOutput(this, 'RehearsalOrigin', { value: origin });
  }
}
