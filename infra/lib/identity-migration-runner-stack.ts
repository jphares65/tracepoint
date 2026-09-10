import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface IdentityMigrationRunnerStackProps extends cdk.StackProps {
  environmentName: 'staging' | 'production';
  runId: string;
  authorizationReference: string;
  manifestSha256: string;
  commit: string;
  imageDigest: string;
  repositoryName: string;
  clusterName: string;
  vpcId: string;
  publicSubnetIds: string[];
  databaseSecurityGroupId: string;
  databaseSecretArn: string;
  applicationSecretArn: string;
  artifactBucketName: string;
  artifactKeyArn: string;
  userPoolId: string;
  clientId: string;
  fromAddress: string;
  sesConfigurationSet: string;
}

export class IdentityMigrationRunnerStack extends cdk.Stack {
  readonly taskDefinition: ecs.FargateTaskDefinition;
  readonly runnerSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: IdentityMigrationRunnerStackProps) {
    super(scope, id, props);
    const expectedAccount = props.environmentName === 'staging' ? '559054714699' : this.account;
    if (this.region !== 'us-east-1' || !/^\d{12}$/.test(this.account) || this.account === '265544358665' || this.account !== expectedAccount) throw new Error('A matching workload account in us-east-1 is required');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(props.runId)) throw new Error('A random migration run UUID is required');
    if (!/^[A-Z0-9][A-Z0-9._:/-]{7,127}$/.test(props.authorizationReference)) throw new Error('A specific identity migration authorization is required');
    if (!/^[0-9a-f]{64}$/.test(props.manifestSha256) || !/^[0-9a-f]{40}$/.test(props.commit) || !/^sha256:[0-9a-f]{64}$/.test(props.imageDigest)) throw new Error('Immutable manifest, source, and image are required');
    if (props.publicSubnetIds.length !== 2 || new Set(props.publicSubnetIds).size !== 2 || props.publicSubnetIds.some(idValue => !/^subnet-[0-9a-f]+$/.test(idValue))) throw new Error('Exactly two reviewed public subnets are required');
    const secretPrefix = `arn:aws:secretsmanager:us-east-1:${this.account}:secret:`;
    if (!props.databaseSecretArn.startsWith(secretPrefix) || !props.applicationSecretArn.startsWith(secretPrefix) || props.databaseSecretArn === props.applicationSecretArn) throw new Error('Distinct database and AWS-native application secrets are required');
    if (props.artifactBucketName !== `tracepoint-${props.environmentName}-private-${this.account}` || !new RegExp(`^arn:aws:kms:us-east-1:${this.account}:key/[0-9a-f-]{36}$`).test(props.artifactKeyArn)) throw new Error('Reviewed KMS artifact storage is required');
    if (!/^us-east-1_[A-Za-z0-9]+$/.test(props.userPoolId) || !/^[A-Za-z0-9]{1,128}$/.test(props.clientId)) throw new Error('Cognito target is invalid');
    const domain = props.environmentName === 'staging' ? 'staging.tracepointhq.com' : 'tracepointhq.com';
    if (props.fromAddress !== `notifications@${domain}` || props.sesConfigurationSet !== `tracepoint-${props.environmentName}`) throw new Error('SES target is invalid');

    cdk.Tags.of(this).add('Purpose', 'temporary-identity-migration');
    cdk.Tags.of(this).add('MigrationRun', props.runId);
    cdk.Tags.of(this).add('ArchitectureTarget', 'full-aws');

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', { vpcId: props.vpcId, availabilityZones: ['us-east-1a', 'us-east-1b'], publicSubnetIds: props.publicSubnetIds });
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', { clusterName: props.clusterName, vpc });
    const repository = ecr.Repository.fromRepositoryName(this, 'Repository', props.repositoryName);
    const databaseSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', props.databaseSecretArn);
    const applicationSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'ApplicationSecret', props.applicationSecretArn);
    const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', props.artifactBucketName);
    const artifactKey = kms.Key.fromKeyArn(this, 'ArtifactKey', props.artifactKeyArn);
    const databaseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'DatabaseSecurityGroup', props.databaseSecurityGroupId, { mutable: true });

    const logKey = new kms.Key(this, 'LogKey', { enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.RETAIN, alias: `alias/tracepoint/${props.environmentName}/identity-migration-${props.runId}` });
    logKey.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal('logs.us-east-1.amazonaws.com')],
      actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'], resources: ['*'],
      conditions: { ArnLike: { 'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:us-east-1:${this.account}:log-group:/tracepoint/${props.environmentName}/identity-migration/${props.runId}*` } },
    }));
    const logGroup = new logs.LogGroup(this, 'Logs', { logGroupName: `/tracepoint/${props.environmentName}/identity-migration/${props.runId}`, encryptionKey: logKey, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const taskRole = new iam.Role(this, 'TaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    const executionRole = new iam.Role(this, 'ExecutionRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    databaseSecret.grantRead(executionRole);
    applicationSecret.grantRead(executionRole);
    artifactKey.grantDecrypt(executionRole);
    repository.grantPull(executionRole);
    const artifactPrefix = `migration/identity/${props.runId}`;
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [artifactBucket.arnForObjects(`${artifactPrefix}/manifest.json`), artifactBucket.arnForObjects(`${artifactPrefix}/checkpoint.json`)] }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [artifactBucket.arnForObjects(`${artifactPrefix}/checkpoint.json`), artifactBucket.arnForObjects(`${artifactPrefix}/evidence.json`)] }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['kms:Decrypt', 'kms:GenerateDataKey'], resources: [artifactKey.keyArn], conditions: { StringEquals: { 'kms:ViaService': 's3.us-east-1.amazonaws.com' } } }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminGetUser'], resources: [`arn:aws:cognito-idp:us-east-1:${this.account}:userpool/${props.userPoolId}`] }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:aws:ses:us-east-1:${this.account}:identity/${domain}`], conditions: { StringEquals: { 'ses:FromAddress': props.fromAddress } } }));

    this.runnerSecurityGroup = new ec2.SecurityGroup(this, 'RunnerSecurityGroup', { vpc, allowAllOutbound: false, description: 'Temporary full-AWS identity migration runner; no inbound traffic' });
    this.runnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'TLS PostgreSQL target');
    this.runnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'AWS control plane APIs');
    databaseSecurityGroup.addIngressRule(this.runnerSecurityGroup, ec2.Port.tcp(5432), 'Temporary identity migration runner');

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', { family: `tracepoint-${props.environmentName}-identity-migration-${props.runId}`, cpu: 512, memoryLimitMiB: 1024, taskRole, executionRole });
    this.taskDefinition.addVolume({ name: 'migration-tmp' });
    const container = this.taskDefinition.addContainer('migration', {
      image: ecs.ContainerImage.fromRegistry(`${repository.repositoryUri}@${props.imageDigest}`),
      readonlyRootFilesystem: true,
      user: 'node',
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'runner' }),
      environment: {
        AWS_REGION: 'us-east-1', CONFIGURATION_ENVIRONMENT: props.environmentName,
        TRACEPOINT_AWS_ACCOUNT_ID: this.account, TRACEPOINT_RUNTIME_PROVIDER_MODE: 'aws-native', TRACEPOINT_DATA_PROVIDER: 'postgres', TRACEPOINT_AUTH_PROVIDER: 'cognito', TRACEPOINT_STORAGE_PROVIDER: 's3', TRACEPOINT_EMAIL_PROVIDER: 'ses',
        TRACEPOINT_DATABASE_CA_PATH: '/app/rds-ca.pem', TRACEPOINT_DATABASE_POOL_MAX: '2',
        TRACEPOINT_COGNITO_USER_POOL_ID: props.userPoolId, TRACEPOINT_COGNITO_CLIENT_ID: props.clientId,
        TRACEPOINT_FROM_EMAIL: props.fromAddress, TRACEPOINT_SES_CONFIGURATION_SET: props.sesConfigurationSet,
        TRACEPOINT_IDENTITY_MIGRATION_RUN_ID: props.runId, TRACEPOINT_IDENTITY_MIGRATION_AUTHORIZATION: `${props.authorizationReference}:${props.manifestSha256}`,
        TRACEPOINT_MIGRATION_ARTIFACT_BUCKET: props.artifactBucketName, TRACEPOINT_MIGRATION_ARTIFACT_KMS_KEY_ARN: props.artifactKeyArn,
        TRACEPOINT_IDENTITY_MANIFEST_KEY: `${artifactPrefix}/manifest.json`, TRACEPOINT_IDENTITY_CHECKPOINT_KEY: `${artifactPrefix}/checkpoint.json`, TRACEPOINT_IDENTITY_EVIDENCE_KEY: `${artifactPrefix}/evidence.json`, TRACEPOINT_IDENTITY_MANIFEST_SHA256: props.manifestSha256,
      },
      secrets: {
        TRACEPOINT_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(databaseSecret),
        TRACEPOINT_AUTH_STATE_KEYS: ecs.Secret.fromSecretsManager(applicationSecret, 'TRACEPOINT_AUTH_STATE_KEYS'),
        TRACEPOINT_AUTH_REFRESH_KEYS: ecs.Secret.fromSecretsManager(applicationSecret, 'TRACEPOINT_AUTH_REFRESH_KEYS'),
      },
    });
    container.addMountPoints({ containerPath: '/tmp', sourceVolume: 'migration-tmp', readOnly: false });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'TaskDefinitionArn', { value: this.taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'RunnerSecurityGroupId', { value: this.runnerSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'PublicSubnetIds', { value: props.publicSubnetIds.join(',') });
    new cdk.CfnOutput(this, 'EvidenceObjectKey', { value: `${artifactPrefix}/evidence.json` });
  }
}
