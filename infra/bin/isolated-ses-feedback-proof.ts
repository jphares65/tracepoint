import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';

const account = '193644343389';
const region = 'us-east-1';
const secretArn = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/rehearsal/database-runtime-4272874f-uDq389';
const topicArn = 'arn:aws:sns:us-east-1:193644343389:tracepoint-production-ses-feedback';
const dataKeyArn = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'tracepoint-production-isolated-ses-feedback-proof', {
  env: { account, region },
  description: 'Direct-invoke-only SES feedback proof; no SNS subscription, SQS mapping, or public traffic',
  terminationProtection: true,
});

const role = new iam.Role(stack, 'WorkerRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyArn(stack, 'Boundary',
    `arn:aws:iam::${account}:policy/TracePointProductionBoundary`),
  description: 'Isolated direct-invoke feedback proof; rehearsal RDS secret only',
});
role.addToPolicy(new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [secretArn] }));
role.addToPolicy(new iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: [dataKeyArn],
  conditions: { StringEquals: { 'kms:ViaService': 'secretsmanager.us-east-1.amazonaws.com' } } }));
role.addToPolicy(new iam.PolicyStatement({ actions: [
  'ec2:CreateNetworkInterface', 'ec2:DescribeNetworkInterfaces', 'ec2:DeleteNetworkInterface',
  'ec2:AssignPrivateIpAddresses', 'ec2:UnassignPrivateIpAddresses',
], resources: ['*'], conditions: { StringEquals: { 'aws:RequestedRegion': region } } }));

const logGroup = new logs.LogGroup(stack, 'Logs', {
  logGroupName: '/tracepoint/production/isolated-ses-feedback-proof',
  retention: logs.RetentionDays.ONE_WEEK,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
role.addToPolicy(new iam.PolicyStatement({ actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
  resources: [`${logGroup.logGroupArn}:*`] }));

const vpc = ec2.Vpc.fromVpcAttributes(stack, 'Vpc', {
  vpcId: 'vpc-04accb4047a914176', availabilityZones: ['us-east-1a'],
  isolatedSubnetIds: ['subnet-0b9260c4d5a6ed8bb'],
});
const subnet = ec2.Subnet.fromSubnetId(stack, 'PrivateSubnet', 'subnet-0b9260c4d5a6ed8bb');
const network = ec2.SecurityGroup.fromSecurityGroupId(stack, 'ExistingWorkerSecurity', 'sg-099fcb51bfa94d107');
const caLayer = lambda.LayerVersion.fromLayerVersionArn(stack, 'ExistingRdsCa',
  'arn:aws:lambda:us-east-1:193644343389:layer:RdsCaLayerA2BC9133:1');

const worker = new lambdaNode.NodejsFunction(stack, 'Worker', {
  entry: path.resolve(__dirname, '../../src/lib/email/ses-feedback-handler.ts'),
  handler: 'handler', runtime: lambda.Runtime.NODEJS_24_X, role,
  depsLockFilePath: path.resolve(__dirname, '../../package-lock.json'),
  projectRoot: path.resolve(__dirname, '../..'),
  bundling: { minify: true, sourceMap: true, nodeModules: ['pg'] },
  timeout: cdk.Duration.seconds(30), memorySize: 256,
  vpc, vpcSubnets: { subnets: [subnet] }, securityGroups: [network],
  layers: [caLayer], logGroup,
  environment: {
    TRACEPOINT_AWS_ACCOUNT: account,
    TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY: 'rehearsal',
    TRACEPOINT_DATABASE_SECRET_ARN: secretArn,
    TRACEPOINT_RDS_CA_PATH: '/opt/us-east-1-bundle.pem',
    TRACEPOINT_SES_FEEDBACK_TOPIC_ARN: topicArn,
    TRACEPOINT_COGNITO_SES_CONFIGURATION_SET: 'tracepoint-production-cognito',
  },
});

new cdk.CfnOutput(stack, 'WorkerArn', { value: worker.functionArn });
new cdk.CfnOutput(stack, 'Authority', { value: 'rehearsal-only-direct-invoke' });
