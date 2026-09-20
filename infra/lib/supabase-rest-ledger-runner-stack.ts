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
  readonly executionRole: iam.Role;
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

    this.executionRole = new iam.Role(this, 'ExecutionRole', { roleName: `TracePointProdRestLedgerExec-${runSuffix}`, assumedBy: taskPrincipal, description: 'Temporary source-only TracePoint Supabase REST/Admin ledger execution role' });
    const boundary = iam.ManagedPolicy.fromManagedPolicyArn(this, 'ProductionPermissionsBoundary', `arn:aws:iam::${account}:policy/TracePointProductionBoundary`);
    iam.PermissionsBoundary.of(this.executionRole).apply(boundary);
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadOnlyDedicatedSupabaseRestSecret', actions: ['secretsmanager:GetSecretValue'], resources: [props.sourceSecretArn],
    }));
    this.executionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'PullOnlyReviewedMigrationImage', actions: ['ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], resources: [repository.repositoryArn],
    }));
    this.executionRole.addToPolicy(new iam.PolicyStatement({ sid: 'EcrAuthenticationForReviewedRepository', actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));

    const logGroup = new logs.LogGroup(this, 'Logs', { logGroupName: `/tracepoint/production/supabase-rest-ledger/${props.runId}`, retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.RETAIN });
    this.executionRole.addToPolicy(new iam.PolicyStatement({ sid: 'WriteSanitizedLedgerEvidenceOnly', actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [logGroup.logGroupArn] }));
    this.runnerSecurityGroup = new ec2.SecurityGroup(this, 'RunnerSecurityGroup', { vpc, allowAllOutbound: false, description: 'Temporary source-only Supabase REST ledger runner; HTTPS egress only and no inbound traffic' });
    this.runnerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'TLS HTTPS to reviewed Supabase and AWS control planes');

    // L1 is intentional: source-only work has no application task role. The ECS
    // execution role is the sole principal and receives only image/log/one-secret rights.
    this.taskDefinition = new ecs.CfnTaskDefinition(this, 'TaskDefinition', {
      family: `tracepoint-production-supabase-rest-ledger-${runSuffix}`,
      requiresCompatibilities: ['FARGATE'], networkMode: 'awsvpc', cpu: '512', memory: '1024', executionRoleArn: this.executionRole.roleArn,
      containerDefinitions: [{
        name: 'source-ledger', image: `${repository.repositoryUri}@${props.imageDigest}`, essential: true, readonlyRootFilesystem: true, user: 'node',
        logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': logGroup.logGroupName, 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'source-ledger' } },
        environment: [
          { name: 'TRACEPOINT_MIGRATION_RUN_ID', value: props.runId }, { name: 'TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE', value: props.authorizationReference },
          { name: 'TRACEPOINT_EXPECTED_AWS_ACCOUNT', value: account }, { name: 'SOURCE_SUPABASE_REST_SECRET_ARN', value: props.sourceSecretArn }, { name: 'TRACEPOINT_SOURCE_COMMIT', value: props.commit },
        ],
        secrets: [{ name: 'SOURCE_SUPABASE_REST_SECRET_JSON', valueFrom: props.sourceSecretArn }],
      }],
    });
    for (const resource of [this.executionRole.node.defaultChild, this.taskDefinition, this.runnerSecurityGroup.node.defaultChild, logGroup.node.defaultChild]) (resource as cdk.CfnResource).addMetadata('com.aws.cloudformation.Context', { purpose: 'isolated source-only Supabase REST/Admin ledger', noTargetAccess: true, authorizationReference: props.authorizationReference });
    new cdk.CfnOutput(this, 'ExecutionRoleArn', { value: this.executionRole.roleArn });
    new cdk.CfnOutput(this, 'TaskDefinitionArn', { value: this.taskDefinition.ref });
    new cdk.CfnOutput(this, 'RunnerSecurityGroupId', { value: this.runnerSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
  }
}
