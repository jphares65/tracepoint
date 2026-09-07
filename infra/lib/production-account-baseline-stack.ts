import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ce from 'aws-cdk-lib/aws-ce';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as config from 'aws-cdk-lib/aws-config';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as securityhub from 'aws-cdk-lib/aws-securityhub';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import {NagSuppressions} from 'cdk-nag';
import {Construct} from 'constructs';

export interface ProductionAccountBaselineStackProps extends cdk.StackProps {
  readonly accountId: string;
}

const configResourceTypes = [
  'AWS::CloudFormation::Stack',
  'AWS::CloudTrail::Trail',
  'AWS::CodeBuild::Project',
  'AWS::EC2::EIP',
  'AWS::EC2::InternetGateway',
  'AWS::EC2::NetworkAcl',
  'AWS::EC2::RouteTable',
  'AWS::EC2::SecurityGroup',
  'AWS::EC2::Subnet',
  'AWS::EC2::VPC',
  'AWS::EC2::VPCEndpoint',
  'AWS::ECR::Repository',
  'AWS::ECS::Cluster',
  'AWS::ECS::Service',
  'AWS::ECS::TaskDefinition',
  'AWS::ElasticLoadBalancingV2::Listener',
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::ElasticLoadBalancingV2::TargetGroup',
  'AWS::IAM::Role',
  'AWS::KMS::Key',
  'AWS::Logs::LogGroup',
  'AWS::S3::Bucket',
  'AWS::SecretsManager::Secret',
  'AWS::SNS::Topic',
  'AWS::SQS::Queue',
  'AWS::WAFv2::WebACL',
];

export class ProductionAccountBaselineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ProductionAccountBaselineStackProps) {
    super(scope, id, props);
    if (cdk.Stack.of(this).account !== props.accountId || props.accountId === '265544358665') {
      throw new Error('Dedicated production account required for account baseline');
    }

    const boundary = iam.ManagedPolicy.fromManagedPolicyArn(
      this,
      'ProductionPermissionsBoundary',
      cdk.Stack.of(this).formatArn({service: 'iam', region: '', resource: 'policy', resourceName: 'TracePointProductionBoundary'}),
    );
    iam.PermissionsBoundary.of(this).apply(boundary);

    const auditKey = new kms.Key(this, 'AuditKey', {
      alias: 'alias/tracepoint/production/audit',
      description: 'TracePoint production account audit, configuration and notification key',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const accessLogs = new s3.Bucket(this, 'AuditAccessLogs', {
      bucketName: `tracepoint-production-audit-access-${props.accountId}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    NagSuppressions.addResourceSuppressions(accessLogs, [{
      id: 'AwsSolutions-S1',
      reason: 'This is the dedicated server-access-log sink; recursive access logging is intentionally avoided.',
    }], true);

    const auditBucket = new s3.Bucket(this, 'AuditBucket', {
      bucketName: `tracepoint-production-audit-${props.accountId}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: auditKey,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogs,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const trailLogs = new logs.LogGroup(this, 'TrailLogs', {
      logGroupName: '/tracepoint/production/account/cloudtrail',
      encryptionKey: auditKey,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cloudtrail.Trail(this, 'AuditTrail', {
      trailName: 'tracepoint-production-audit',
      bucket: auditBucket,
      cloudWatchLogGroup: trailLogs,
      encryptionKey: auditKey,
      enableFileValidation: true,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
      sendToCloudWatchLogs: true,
    });

    const configRole = new iam.Role(this, 'ConfigRole', {
      roleName: 'TracePoint-Production-Config',
      assumedBy: new iam.ServicePrincipal('config.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWS_ConfigRole')],
    });
    configRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetBucketAcl', 's3:ListBucket'],
      resources: [auditBucket.bucketArn],
    }));
    configRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`${auditBucket.bucketArn}/config/AWSLogs/${props.accountId}/*`],
    }));
    configRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:DescribeKey', 'kms:GenerateDataKey'],
      resources: [auditKey.keyArn],
    }));
    NagSuppressions.addResourceSuppressions(configRole, [{
      id: 'AwsSolutions-IAM4',
      appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWS_ConfigRole'],
      reason: 'AWS Config requires its AWS-managed service-role policy to discover supported resource types as the service evolves.',
    }, {
      id: 'AwsSolutions-IAM5',
      reason: 'AWS Config must write configuration objects beneath the exact account-scoped config/AWSLogs prefix; no broader bucket or action wildcard is granted.',
    }], true);

    const recorder = new config.CfnConfigurationRecorder(this, 'ConfigurationRecorder', {
      name: 'tracepoint-production',
      roleArn: configRole.roleArn,
      recordingGroup: {
        allSupported: false,
        includeGlobalResourceTypes: false,
        resourceTypes: configResourceTypes,
        recordingStrategy: {useOnly: 'INCLUSION_BY_RESOURCE_TYPES'},
      },
      recordingMode: {recordingFrequency: 'CONTINUOUS'},
    });
    const channel = new config.CfnDeliveryChannel(this, 'ConfigurationDeliveryChannel', {
      name: 'tracepoint-production',
      s3BucketName: auditBucket.bucketName,
      s3KeyPrefix: 'config',
      configSnapshotDeliveryProperties: {deliveryFrequency: 'TwentyFour_Hours'},
    });
    channel.addResourceDependency(recorder);

    new guardduty.CfnDetector(this, 'GuardDutyDetector', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
      tags: [{key: 'Application', value: 'TracePoint'}, {key: 'Environment', value: 'production'}],
    });
    new securityhub.CfnHubV2(this, 'SecurityHub', {
      tags: {Application: 'TracePoint', Environment: 'production'},
    });

    new cdk.CfnOutput(this, 'AuditBucketName', {value: auditBucket.bucketName});
    new cdk.CfnOutput(this, 'AuditKeyArn', {value: auditKey.keyArn});
  }
}

export interface ProductionCostControlsStackProps extends cdk.StackProps {
  readonly accountId: string;
  readonly monthlyBudgetUsd: number;
}

export class ProductionCostControlsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ProductionCostControlsStackProps) {
    super(scope, id, props);
    if (props.accountId === '265544358665' || props.monthlyBudgetUsd !== 150) {
      throw new Error('Reviewed production account and monthly budget are required');
    }

    const key = new kms.Key(this, 'CostAlertsKey', {
      alias: 'alias/tracepoint/production/cost-alerts',
      description: 'TracePoint production cost alert encryption key',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    key.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCostServicesToUseKey',
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com'), new iam.ServicePrincipal('costalerts.amazonaws.com')],
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      resources: ['*'],
      conditions: {StringEquals: {'aws:SourceAccount': props.accountId}},
    }));
    const deadLetterQueue = new sqs.Queue(this, 'CostAlertsDeadLetterQueue', {
      queueName: 'tracepoint-production-cost-alerts-dead-letter',
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: key,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });
    const queue = new sqs.Queue(this, 'CostAlertsQueue', {
      queueName: 'tracepoint-production-cost-alerts',
      deadLetterQueue: {queue: deadLetterQueue, maxReceiveCount: 3},
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: key,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });
    const topic = new sns.Topic(this, 'CostAlertsTopic', {
      topicName: 'tracepoint-production-cost-alerts',
      masterKey: key,
    });
    topic.addSubscription(new subscriptions.SqsSubscription(queue, {rawMessageDelivery: true}));
    for (const service of ['budgets.amazonaws.com', 'costalerts.amazonaws.com']) {
      topic.addToResourcePolicy(new iam.PolicyStatement({
        sid: `Allow${service.startsWith('budgets') ? 'Budgets' : 'CostAnomaly'}Publish`,
        principals: [new iam.ServicePrincipal(service)],
        actions: ['sns:Publish'],
        resources: [topic.topicArn],
        conditions: {StringEquals: {'aws:SourceAccount': props.accountId}},
      }));
    }

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'tracepoint-production-monthly',
        budgetLimit: {amount: props.monthlyBudgetUsd, unit: 'USD'},
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
      },
      notificationsWithSubscribers: [
        {
          notification: {comparisonOperator: 'GREATER_THAN', notificationType: 'ACTUAL', threshold: 80, thresholdType: 'PERCENTAGE'},
          subscribers: [{address: topic.topicArn, subscriptionType: 'SNS'}],
        },
        {
          notification: {comparisonOperator: 'GREATER_THAN', notificationType: 'FORECASTED', threshold: 100, thresholdType: 'PERCENTAGE'},
          subscribers: [{address: topic.topicArn, subscriptionType: 'SNS'}],
        },
      ],
    });

    const monitor = new ce.CfnAnomalyMonitor(this, 'ServiceCostMonitor', {
      monitorDimension: 'SERVICE',
      monitorName: 'tracepoint-production-services',
      monitorType: 'DIMENSIONAL',
      resourceTags: [{key: 'Application', value: 'TracePoint'}, {key: 'Environment', value: 'production'}],
    });
    new ce.CfnAnomalySubscription(this, 'CostAnomalySubscription', {
      frequency: 'IMMEDIATE',
      monitorArnList: [monitor.ref],
      subscribers: [{address: topic.topicArn, type: 'SNS'}],
      subscriptionName: 'tracepoint-production-cost-anomalies',
      thresholdExpression: JSON.stringify({Dimensions: {Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE', MatchOptions: ['GREATER_THAN_OR_EQUAL'], Values: ['10']}}),
      resourceTags: [{key: 'Application', value: 'TracePoint'}, {key: 'Environment', value: 'production'}],
    });
  }
}
