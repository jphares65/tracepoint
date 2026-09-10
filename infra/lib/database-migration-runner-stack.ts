import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DatabaseMigrationRunnerStackProps extends cdk.StackProps {
  environmentName: 'staging' | 'production';
  runId: string;
  authorizationReference: string;
  commit: string;
  imageDigest: string;
  repositoryName: string;
  clusterName: string;
  vpcId: string;
  publicSubnetIds: string[];
  databaseSecurityGroupId: string;
  sourceSecretArn: string;
  targetSecretArn: string;
  sourceHost: string;
  sourceDatabase: string;
  targetHost: string;
  targetDatabase: string;
}

export class DatabaseMigrationRunnerStack extends cdk.Stack {
  readonly taskDefinition: ecs.FargateTaskDefinition;
  readonly runnerSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseMigrationRunnerStackProps) {
    super(scope, id, props);
    if (this.region !== 'us-east-1' || !/^\d{12}$/.test(this.account) || this.account === '265544358665') throw new Error('A workload account in us-east-1 is required');
    if (props.environmentName === 'staging' && this.account !== '559054714699') throw new Error('Staging migration runner account mismatch');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(props.runId)) throw new Error('A random migration run UUID is required');
    if (!/^[0-9a-f]{40}$/.test(props.commit) || !/^sha256:[0-9a-f]{64}$/.test(props.imageDigest)) throw new Error('Immutable migration source and image are required');
    if (!/^[A-Za-z0-9._:/-]{8,200}$/.test(props.authorizationReference)) throw new Error('A migration authorization reference is required');
    if (props.publicSubnetIds.length !== 2 || new Set(props.publicSubnetIds).size !== 2 || props.publicSubnetIds.some(id => !/^subnet-[0-9a-f]+$/.test(id))) throw new Error('Exactly two reviewed public subnets are required');
    const secretPrefix = `arn:aws:secretsmanager:us-east-1:${this.account}:secret:`;
    if (!props.sourceSecretArn.startsWith(secretPrefix) || !props.targetSecretArn.startsWith(secretPrefix) || props.sourceSecretArn === props.targetSecretArn) throw new Error('Distinct source and target secret ARNs are required');
    if (!/^[a-z0-9][a-z0-9.-]+$/.test(props.sourceHost) || !/^[a-z0-9-]+\.[a-z0-9.-]+\.rds\.amazonaws\.com$/.test(props.targetHost) || props.sourceHost === props.targetHost) throw new Error('Reviewed source and RDS target hosts are required');
    for (const database of [props.sourceDatabase, props.targetDatabase]) if (!/^[A-Za-z0-9_-]{1,63}$/.test(database)) throw new Error('Database name is invalid');

    cdk.Tags.of(this).add('Purpose', 'temporary-database-migration');
    cdk.Tags.of(this).add('MigrationRun', props.runId);
    cdk.Tags.of(this).add('ArchitectureTarget', 'full-aws');

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: ['us-east-1a', 'us-east-1b'],
      publicSubnetIds: props.publicSubnetIds,
    });
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', { clusterName: props.clusterName, vpc });
    const repository = ecr.Repository.fromRepositoryName(this, 'Repository', props.repositoryName);
    const sourceSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'SourceSecret', props.sourceSecretArn);
    const targetSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'TargetSecret', props.targetSecretArn);
    const databaseSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'DatabaseSecurityGroup', props.databaseSecurityGroupId, { mutable: true });

    const logKey = new kms.Key(this, 'LogKey', { enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.RETAIN, alias: `alias/tracepoint/${props.environmentName}/database-migration-${props.runId}` });
    logKey.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal('logs.us-east-1.amazonaws.com')],
      actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'], resources: ['*'],
      conditions: { ArnLike: { 'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:us-east-1:${this.account}:log-group:/tracepoint/${props.environmentName}/database-migration/${props.runId}*` } },
    }));
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/tracepoint/${props.environmentName}/database-migration/${props.runId}`,
      encryptionKey: logKey,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const taskRole = new iam.Role(this, 'TaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    const executionRole = new iam.Role(this, 'ExecutionRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    sourceSecret.grantRead(executionRole);
    targetSecret.grantRead(executionRole);
    repository.grantPull(executionRole);

    this.runnerSecurityGroup = new ec2.SecurityGroup(this, 'RunnerSecurityGroup', { vpc, allowAllOutbound: false, description: 'Temporary full-AWS database migration runner; no inbound traffic' });
    this.runnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'TLS PostgreSQL source and target');
    this.runnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'ECR and CloudWatch Logs control plane');
    databaseSecurityGroup.addIngressRule(this.runnerSecurityGroup, ec2.Port.tcp(5432), 'Temporary migration runner');

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: `tracepoint-${props.environmentName}-database-migration-${props.runId}`,
      cpu: 512,
      memoryLimitMiB: 1024,
      ephemeralStorageGiB: 30,
      taskRole,
      executionRole,
    });
    this.taskDefinition.addContainer('migration', {
      image: ecs.ContainerImage.fromRegistry(`${repository.repositoryUri}@${props.imageDigest}`),
      command: ['--execute', '--acknowledge-source-read', '--acknowledge-target-write'],
      readonlyRootFilesystem: true,
      user: 'node',
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'runner' }),
      environment: {
        TRACEPOINT_MIGRATION_RUN_ID: props.runId,
        TRACEPOINT_SOURCE_COMMIT: props.commit,
        TRACEPOINT_EXPECTED_AWS_ACCOUNT: this.account,
        TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE: props.authorizationReference,
        TRACEPOINT_DATABASE_MIGRATION_APPROVAL: props.runId,
        SOURCE_PGHOST: props.sourceHost,
        SOURCE_PGDATABASE: props.sourceDatabase,
        SOURCE_DATABASE_CA_PATH: '/app/rds-ca.pem',
        TARGET_PGHOST: props.targetHost,
        TARGET_PGDATABASE: props.targetDatabase,
        TARGET_DATABASE_CA_PATH: '/app/rds-ca.pem',
      },
      secrets: {
        SOURCE_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(sourceSecret),
        TARGET_DATABASE_SECRET_JSON: ecs.Secret.fromSecretsManager(targetSecret),
      },
    });

    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'TaskDefinitionArn', { value: this.taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, 'RunnerSecurityGroupId', { value: this.runnerSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'PublicSubnetIds', { value: props.publicSubnetIds.join(',') });
  }
}

