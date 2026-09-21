import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface SupabaseRestLedgerRunnerStackProps extends cdk.StackProps {
  runId: string;
  authorizationReference: string;
  commit: string;
  imageDigest: string;
  repositoryName: string;
  clusterName: string;
  vpcId: string;
  publicSubnetIds: string[];
  sourceSecretArn: string;
}

export class SupabaseRestLedgerRunnerStack extends cdk.Stack {
  readonly taskDefinition: ecs.CfnTaskDefinition;
  readonly validatorTaskDefinition: ecs.CfnTaskDefinition;
  readonly executionRole: iam.Role;
  readonly validatorExecutionRole: iam.Role;
  readonly taskRole: iam.Role;
  readonly validatorTaskRole: iam.Role;
  readonly runnerSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SupabaseRestLedgerRunnerStackProps) {
    super(scope, id, props);
    const account = '193644343389';
    const runSuffix = '4272874f';
    if (this.account !== account || this.region !== 'us-east-1') throw new Error('Production account and us-east-1 are required');
    if (props.runId !== '4272874f-bae4-49f4-a0b4-67a39cec2874' || props.authorizationReference !== 'TP-FINAL-DB-20260920-4272874FBAE4') throw new Error('Exact reviewed migration authorization is required');
    if (!/^[0-9a-f]{40}$/.test(props.commit) || !/^sha256:[0-9a-f]{64}$/.test(props.imageDigest)) throw new Error('Immutable source commit and image digest are required');
    if (props.repositoryName !== 'tracepoint-production' || props.clusterName !== 'tracepoint-production') throw new Error('Only the reviewed production repository and cluster are permitted');
    if (props.vpcId !== 'vpc-04accb4047a914176' || props.publicSubnetIds.length !== 2 || new Set(props.publicSubnetIds).size !== 2 || !props.publicSubnetIds.every(subnet => ['subnet-0f4cbed3e60d90bfc', 'subnet-0a117bec5cb98607f'].includes(subnet))) throw new Error('Only the reviewed public migration subnets are permitted');
    const expectedSecretArn = `arn:aws:secretsmanager:us-east-1:${account}:secret:tracepoint/production/migration/source-supabase-rest-wvh4pi`;
    if (props.sourceSecretArn !== expectedSecretArn) throw new Error('Only the dedicated REST source secret is permitted');

    cdk.Tags.of(this).add('Purpose', 'source-only-supabase-rest-ledger');
    cdk.Tags.of(this).add('MigrationRun', props.runId);
    cdk.Tags.of(this).add('AuthorizationReference', props.authorizationReference);
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', { vpcId: props.vpcId, availabilityZones: ['us-east-1a', 'us-east-1b'], publicSubnetIds: props.publicSubnetIds });
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', { clusterName: props.clusterName, vpc });
    const repository = ecr.Repository.fromRepositoryName(this, 'Repository', props.repositoryName);
    const sourceSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'SourceSecret', props.sourceSecretArn);
    const taskPrincipal = new iam.ServicePrincipal('ecs-tasks.amazonaws.com', { conditions: { StringEquals: { 'aws:SourceAccount': account }, ArnLike: { 'aws:SourceArn': `arn:${this.partition}:ecs:us-east-1:${account}:*` } } });

    // The existing CloudFormation execution-boundary permits passing only
    // TracePoint-* roles to ECS tasks. Keeping this temporary role in that
    // reviewed naming family avoids expanding the already-full boundary.
    this.executionRole = new iam.Role(this, 'ExecutionRole', { roleName: `TracePoint-RestLedgerExec-${runSuffix}`, assumedBy: taskPrincipal, description: 'Temporary source-only TracePoint Supabase REST/Admin ledger execution role' });
    const boundary = iam.ManagedPolicy.fromManagedPolicyArn(this, 'ProductionPermissionsBoundary', `arn:aws:iam::${account}:policy/TracePointProductionBoundary`);
    iam.PermissionsBoundary.of(this.executionRole).apply(boundary);
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadOnlyDedicatedSupabaseRestSecret', actions: ['secretsmanager:GetSecretValue'], resources: [props.sourceSecretArn],
    }));
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'PullOnlyReviewedMigrationImage', actions: ['ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], resources: [repository.repositoryArn],
    }));
    this.executionRole.addToPolicy(new iam.PolicyStatement({ sid: 'EcrAuthenticationForReviewedRepository', actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));

    this.validatorExecutionRole = new iam.Role(this, 'ValidatorExecutionRole', { roleName: `TracePoint-ArtifactValidatorExec-${runSuffix}`, assumedBy: taskPrincipal, description: 'Temporary execution role for read-only immutable artifact validation' });
    iam.PermissionsBoundary.of(this.validatorExecutionRole).apply(boundary);
    this.validatorExecutionRole.addToPolicy(new iam.PolicyStatement({ sid: 'PullOnlyReviewedMigrationImage', actions: ['ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], resources: [repository.repositoryArn] }));
    this.validatorExecutionRole.addToPolicy(new iam.PolicyStatement({ sid: 'EcrAuthenticationForReviewedRepository', actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));

    const artifactBucket = 'tracepoint-production-private-193644343389';
    const artifactKey = `migration/source/${props.runId}/initial-canonical.json`;
    const artifactKmsKey = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55';
    this.taskRole = new iam.Role(this, 'ArtifactTaskRole', { roleName: `TracePoint-RestLedgerArtifact-${runSuffix}`, assumedBy: taskPrincipal, description: 'Temporary task role that may create exactly one immutable source migration artifact' });
    iam.PermissionsBoundary.of(this.taskRole).apply(boundary);
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'CreateOnlyInitialSourceArtifact', actions: ['s3:PutObject'], resources: [`arn:aws:s3:::${artifactBucket}/${artifactKey}`] }));
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'EncryptOnlyInitialSourceArtifact', actions: ['kms:GenerateDataKey'], resources: [artifactKmsKey], conditions: { StringEquals: { 'kms:ViaService': 's3.us-east-1.amazonaws.com' } } }));

    this.validatorTaskRole = new iam.Role(this, 'ValidatorTaskRole', { roleName: `TracePoint-ArtifactValidator-${runSuffix}`, assumedBy: taskPrincipal, description: 'Temporary task role that may read exactly one immutable source migration artifact' });
    iam.PermissionsBoundary.of(this.validatorTaskRole).apply(boundary);
    this.validatorTaskRole.addToPolicy(new iam.PolicyStatement({ sid: 'ReadOnlyInitialSourceArtifact', actions: ['s3:GetObject'], resources: [`arn:aws:s3:::${artifactBucket}/${artifactKey}`] }));
    this.validatorTaskRole.addToPolicy(new iam.PolicyStatement({ sid: 'DecryptOnlyInitialSourceArtifact', actions: ['kms:Decrypt'], resources: [artifactKmsKey], conditions: { StringEquals: { 'kms:ViaService': 's3.us-east-1.amazonaws.com' } } }));

    const logGroup = new logs.LogGroup(this, 'Logs', { logGroupName: `/tracepoint/production/supabase-rest-ledger/${props.runId}`, retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const validatorLogGroup = new logs.LogGroup(this, 'ValidatorLogs', { logGroupName: `/tracepoint/production/immutable-artifact-validator/${props.runId}`, retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.RETAIN });
    this.executionRole.addToPolicy(new iam.PolicyStatement({ sid: 'WriteSanitizedLedgerEvidenceOnly', actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [logGroup.logGroupArn] }));
    this.validatorExecutionRole.addToPolicy(new iam.PolicyStatement({ sid: 'WriteSanitizedValidatorEvidenceOnly', actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [validatorLogGroup.logGroupArn] }));
    this.runnerSecurityGroup = new ec2.SecurityGroup(this, 'RunnerSecurityGroup', { vpc, allowAllOutbound: false, description: 'Temporary source-only Supabase REST ledger runner; HTTPS egress only and no inbound traffic' });
    this.runnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'TLS HTTPS to reviewed Supabase and AWS control planes');

    // L1 is intentional: source-only work has no application task role. The ECS
    // execution role is the sole principal and receives only image/log/one-secret rights.
    // The snapshot task has already completed. Keep its deployed immutable
    // image/revision pinned so adding a validator cannot replace that task.
    const sourceLedgerCommit = '7add658d88e98469af50f1e4a756744315e4fccd';
    const sourceLedgerDigest = 'sha256:b715caa2ec3418d0a0d890e3fb254da3e910b64c2d3bf1f97b9f6ca5a18445ba';
    this.taskDefinition = new ecs.CfnTaskDefinition(this, 'TaskDefinition', {
      family: `tracepoint-production-supabase-rest-ledger-${runSuffix}`,
      requiresCompatibilities: ['FARGATE'], networkMode: 'awsvpc', cpu: '512', memory: '1024', executionRoleArn: this.executionRole.roleArn, taskRoleArn: this.taskRole.roleArn,
      containerDefinitions: [{
        name: 'source-ledger', image: `${repository.repositoryUri}@${sourceLedgerDigest}`, essential: true, readonlyRootFilesystem: true, user: 'node',
        logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': logGroup.logGroupName, 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'source-ledger' } },
        environment: [
          { name: 'TRACEPOINT_MIGRATION_RUN_ID', value: props.runId }, { name: 'TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE', value: props.authorizationReference },
          { name: 'TRACEPOINT_EXPECTED_AWS_ACCOUNT', value: account }, { name: 'SOURCE_SUPABASE_REST_SECRET_ARN', value: props.sourceSecretArn }, { name: 'TRACEPOINT_SOURCE_COMMIT', value: sourceLedgerCommit },
        ],
        secrets: [{ name: 'SOURCE_SUPABASE_REST_SECRET_JSON', valueFrom: props.sourceSecretArn }],
      }],
    });
    this.validatorTaskDefinition = new ecs.CfnTaskDefinition(this, 'ValidatorTaskDefinition', {
      family: `tracepoint-production-immutable-artifact-validator-${runSuffix}`,
      requiresCompatibilities: ['FARGATE'], networkMode: 'awsvpc', cpu: '512', memory: '1024', executionRoleArn: this.validatorExecutionRole.roleArn, taskRoleArn: this.validatorTaskRole.roleArn,
      containerDefinitions: [{
        name: 'immutable-artifact-validator', image: `${repository.repositoryUri}@${props.imageDigest}`, command: ['scripts/immutable-source-artifact-validator.mjs'], essential: true, readonlyRootFilesystem: true, user: 'node',
        logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': validatorLogGroup.logGroupName, 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'immutable-artifact-validator' } },
        environment: [
          { name: 'TRACEPOINT_MIGRATION_RUN_ID', value: props.runId }, { name: 'TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE', value: props.authorizationReference },
          { name: 'TRACEPOINT_EXPECTED_AWS_ACCOUNT', value: account }, { name: 'TRACEPOINT_SOURCE_ARTIFACT_KEY', value: artifactKey },
          { name: 'TRACEPOINT_SOURCE_ARTIFACT_SHA256', value: '8b01ea2a57a650b10d126160c5d171fecf1e98f1e07a9fa720e97e600d8d6d57' },
        ],
      }],
    });
    for (const resource of [this.executionRole.node.defaultChild, this.taskRole.node.defaultChild, this.taskDefinition, this.runnerSecurityGroup.node.defaultChild, logGroup.node.defaultChild]) (resource as cdk.CfnResource).addMetadata('com.aws.cloudformation.Context', { purpose: 'isolated source-only Supabase REST/Admin ledger', noTargetAccess: true, authorizationReference: props.authorizationReference });
    for (const resource of [this.validatorExecutionRole.node.defaultChild, this.validatorTaskRole.node.defaultChild, this.validatorTaskDefinition, validatorLogGroup.node.defaultChild]) (resource as cdk.CfnResource).addMetadata('com.aws.cloudformation.Context', { purpose: 'isolated immutable source artifact validation', noSourceAccess: true, noTargetAccess: true, authorizationReference: props.authorizationReference });
    new cdk.CfnOutput(this, 'ExecutionRoleArn', { value: this.executionRole.roleArn });
    new cdk.CfnOutput(this, 'TaskDefinitionArn', { value: this.taskDefinition.ref });
    new cdk.CfnOutput(this, 'ValidatorTaskDefinitionArn', { value: this.validatorTaskDefinition.ref });
    new cdk.CfnOutput(this, 'RunnerSecurityGroupId', { value: this.runnerSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
  }
}
