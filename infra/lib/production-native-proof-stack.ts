import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

// Independent of the public bridge stack: no service, listener, DNS record, or
// change to the bridge role/boundary is created here.
export class ProductionNativeProofStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    if (this.account !== '193644343389' || this.region !== 'us-east-1') throw new Error('Exact production account and region required');

    const account = this.account;
    const region = this.region;
    const bucket = `tracepoint-production-private-${account}`;
    const key = `arn:aws:kms:${region}:${account}:key/4dc71990-3cfa-49d7-88c6-383bc1067f55`;
    const repository = `arn:aws:ecr:${region}:${account}:repository/tracepoint-production`;
    const logGroupName = '/tracepoint/production/application';
    const logGroupArn = `arn:aws:logs:${region}:${account}:log-group:${logGroupName}:*`;
    const nativeSecret = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/application/aws-native-rIikku`;
    const databaseSecret = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/final/database-runtime-20260926-yg23sb`;
    const sentryRuntimeSecret = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/sentry-runtime-yGnfPL`;
    const identity = `arn:aws:ses:${region}:${account}:identity/tracepointhq.com`;
    const configurationSet = `arn:aws:ses:${region}:${account}:configuration-set/tracepoint-production`;
    const pool = `arn:aws:cognito-idp:${region}:${account}:userpool/us-east-1_diFmWDMe9`;
    const imageDigest = 'sha256:cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46';

    const runtimeStatements = [
      new iam.PolicyStatement({ actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`arn:aws:s3:::${bucket}/attachments/*`, `arn:aws:s3:::${bucket}/department-assets/*`],
        conditions: { StringEquals: { 's3:ResourceAccount': account } } }),
      new iam.PolicyStatement({ actions: ['kms:Decrypt', 'kms:GenerateDataKey'], resources: [key],
        conditions: { StringEquals: { 'kms:ViaService': `s3.${region}.amazonaws.com` },
          ArnEquals: { 'kms:EncryptionContext:aws:s3:arn': `arn:aws:s3:::${bucket}` } } }),
      new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [identity],
        conditions: { StringEquals: { 'ses:FromAddress': 'notifications@tracepointhq.com' } } }),
      new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [configurationSet] }),
      new iam.PolicyStatement({ actions: [
        'cognito-idp:AdminCreateUser', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser', 'cognito-idp:AdminGetUser', 'cognito-idp:AdminResetUserPassword',
        'cognito-idp:AdminSetUserPassword', 'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminUserGlobalSignOut',
      ], resources: [pool] }),
    ];
    const executionStatements = [
      // ECR authorization is the one genuinely account-level API in this role.
      new iam.PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }),
      new iam.PolicyStatement({ actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'], resources: [repository] }),
      new iam.PolicyStatement({ actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [logGroupArn] }),
      new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'], resources: [nativeSecret, databaseSecret, sentryRuntimeSecret] }),
      new iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: [key],
        conditions: { StringEquals: { 'kms:ViaService': `secretsmanager.${region}.amazonaws.com` } } }),
    ];

    const boundary = new iam.ManagedPolicy(this, 'NativeProofBoundary', {
      managedPolicyName: 'TracePointProductionNativeProofBoundary-v1',
      description: 'Exact upper bound for isolated AWS-native production proof; bridge boundary v16 is unchanged',
      statements: [...runtimeStatements, ...executionStatements,
        new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [sentryRuntimeSecret] })],
    });
    const principal = new iam.ServicePrincipal('ecs-tasks.amazonaws.com', {
      conditions: { StringEquals: { 'aws:SourceAccount': account },
        ArnLike: { 'aws:SourceArn': `arn:aws:ecs:${region}:${account}:*` } },
    });
    const taskRole = new iam.Role(this, 'NativeProofTaskRole', {
      roleName: 'tracepoint-production-aws-native-proof-task-v1', assumedBy: principal,
      permissionsBoundary: boundary,
    });
    const executionRole = new iam.Role(this, 'NativeProofExecutionRole', {
      roleName: 'tracepoint-production-aws-native-proof-execution-v1', assumedBy: principal,
      permissionsBoundary: boundary,
    });
    runtimeStatements.forEach(statement => taskRole.addToPolicy(statement));
    executionStatements.forEach(statement => executionRole.addToPolicy(statement));

    const task = new ecs.FargateTaskDefinition(this, 'NativeProofTask', {
      family: 'tracepoint-production-aws-native-no-traffic-proof', cpu: 512, memoryLimitMiB: 1024,
      taskRole, executionRole,
    });
    const native = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'NativeAppSecret', nativeSecret);
    const database = cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'FinalDatabaseSecret', databaseSecret);
    const logGroup = logs.LogGroup.fromLogGroupName(this, 'ApplicationLogGroup', logGroupName);
    const imageRepository = ecr.Repository.fromRepositoryName(this, 'ProductionImageRepository', 'tracepoint-production');
    const container = task.addContainer('tracepoint', {
      image: ecs.ContainerImage.fromEcrRepository(imageRepository, imageDigest),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'native-proof' }),
      readonlyRootFilesystem: true, user: '65532:65532', stopTimeout: cdk.Duration.seconds(30),
      environment: {
        NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0', NEXT_PUBLIC_SITE_URL: 'https://tracepointhq.com',
        TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native', TRACEPOINT_DATA_PROVIDER: 'postgres',
        TRACEPOINT_AUTH_PROVIDER: 'cognito', TRACEPOINT_EMAIL_PROVIDER: 'ses', TRACEPOINT_STORAGE_PROVIDER: 's3',
        TRACEPOINT_NOTIFICATION_MODE: 'normal', TRACEPOINT_DATABASE_CA_PATH: '/app/rds-ca.pem',
        TRACEPOINT_COGNITO_USER_POOL_ID: 'us-east-1_diFmWDMe9',
        TRACEPOINT_COGNITO_CLIENT_ID: '9tfp383dgjuvanhnh94bstafr',
        TRACEPOINT_SES_CONFIGURATION_SET: 'tracepoint-production',
        TRACEPOINT_FROM_EMAIL: 'notifications@tracepointhq.com',
        TRACEPOINT_S3_BUCKET: bucket, TRACEPOINT_S3_EXPECTED_OWNER: account,
        TRACEPOINT_AWS_ACCOUNT_ID: account, AWS_REGION: region,
      },
      secrets: {
        CONFIGURATION_ENVIRONMENT: ecs.Secret.fromSecretsManager(native, 'CONFIGURATION_ENVIRONMENT'),
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(native, 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'),
        NOTIFICATION_DISPATCH_SECRET: ecs.Secret.fromSecretsManager(native, 'NOTIFICATION_DISPATCH_SECRET'),
        TRACEPOINT_AUTH_STATE_KEYS: ecs.Secret.fromSecretsManager(native, 'TRACEPOINT_AUTH_STATE_KEYS'),
        TRACEPOINT_AUTH_REFRESH_KEYS: ecs.Secret.fromSecretsManager(native, 'TRACEPOINT_AUTH_REFRESH_KEYS'),
        TRACEPOINT_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(database),
      },
    });
    task.addVolume({ name: 'runtime-cache' });
    task.addVolume({ name: 'temporary-files' });
    container.addMountPoints(
      { sourceVolume: 'runtime-cache', containerPath: '/app/.next/cache', readOnly: false },
      { sourceVolume: 'temporary-files', containerPath: '/tmp', readOnly: false },
    );
    new cdk.CfnOutput(this, 'TaskDefinitionArn', { value: task.taskDefinitionArn });
    new cdk.CfnOutput(this, 'TaskRoleArn', { value: taskRole.roleArn });
    new cdk.CfnOutput(this, 'BoundaryArn', { value: boundary.managedPolicyArn });
  }
}
