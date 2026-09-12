import assert from 'node:assert/strict';

export const productionConfigResourceTypes = Object.freeze([
  'AWS::Backup::BackupPlan', 'AWS::Backup::BackupSelection', 'AWS::Backup::BackupVault',
  'AWS::CloudWatch::Alarm',
  'AWS::CloudFormation::Stack', 'AWS::CloudTrail::Trail', 'AWS::CodeBuild::Project',
  'AWS::Cognito::UserPool', 'AWS::Cognito::UserPoolClient', 'AWS::Cognito::UserPoolDomain',
  'AWS::EC2::EIP', 'AWS::EC2::InternetGateway', 'AWS::EC2::NetworkAcl',
  'AWS::EC2::RouteTable', 'AWS::EC2::SecurityGroup', 'AWS::EC2::Subnet', 'AWS::EC2::VPC',
  'AWS::EC2::VPCEndpoint', 'AWS::ECR::Repository', 'AWS::ECS::Cluster', 'AWS::ECS::Service',
  'AWS::ECS::TaskDefinition', 'AWS::ElasticLoadBalancingV2::Listener',
  'AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::ElasticLoadBalancingV2::TargetGroup',
  'AWS::Events::Rule', 'AWS::IAM::Policy', 'AWS::IAM::Role', 'AWS::KMS::Key',
  'AWS::Lambda::Function', 'AWS::Logs::LogGroup',
  'AWS::RDS::DBCluster', 'AWS::RDS::DBInstance', 'AWS::RDS::DBSubnetGroup',
  'AWS::S3::Bucket', 'AWS::S3::BucketPolicy', 'AWS::SecretsManager::Secret',
  'AWS::SES::ConfigurationSet', 'AWS::SNS::Topic', 'AWS::SQS::Queue', 'AWS::WAFv2::WebACL',
]);

export function productionConfigDefinition(account) {
  assert.match(account, /^\d{12}$/);
  assert.notEqual(account, '265544358665');
  assert.notEqual(account, '559054714699');
  return {
    recorder: {
      name: 'tracepoint-production',
      roleARN: `arn:aws:iam::${account}:role/TracePoint-Production-Config`,
      recordingGroup: {
        allSupported: false,
        includeGlobalResourceTypes: false,
        resourceTypes: productionConfigResourceTypes,
        recordingStrategy: {useOnly: 'INCLUSION_BY_RESOURCE_TYPES'},
      },
      recordingMode: {recordingFrequency: 'CONTINUOUS'},
    },
    channel: {
      name: 'tracepoint-production',
      s3BucketName: `tracepoint-production-audit-primary-${account}`,
      s3KeyPrefix: 'config',
      configSnapshotDeliveryProperties: {deliveryFrequency: 'TwentyFour_Hours'},
    },
  };
}

export function evaluateProductionConfig({recorders = [], channels = [], statuses = []}, account) {
  const desired = productionConfigDefinition(account);
  const recorder = recorders.find(value => value.name === desired.recorder.name);
  const channel = channels.find(value => value.name === desired.channel.name);
  const status = statuses.find(value => value.name === desired.recorder.name);
  return {
    recorderMatches: recorder?.roleARN === desired.recorder.roleARN
      && recorder?.recordingGroup?.allSupported === false
      && recorder?.recordingGroup?.includeGlobalResourceTypes === false
      && recorder?.recordingGroup?.recordingStrategy?.useOnly === 'INCLUSION_BY_RESOURCE_TYPES'
      && JSON.stringify(recorder?.recordingGroup?.resourceTypes) === JSON.stringify(desired.recorder.recordingGroup.resourceTypes)
      && recorder?.recordingMode?.recordingFrequency === 'CONTINUOUS',
    channelMatches: channel?.name === desired.channel.name
      && channel?.s3BucketName === desired.channel.s3BucketName
      && channel?.s3KeyPrefix === desired.channel.s3KeyPrefix
      && channel?.configSnapshotDeliveryProperties?.deliveryFrequency === 'TwentyFour_Hours',
    recording: status?.recording === true && status?.lastStatus === 'SUCCESS',
  };
}
