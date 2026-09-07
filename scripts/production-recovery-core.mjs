import assert from 'node:assert/strict';

const expectedStacks = [
  'tracepoint-production-network',
  'tracepoint-production-security',
  'tracepoint-production-compute',
  'tracepoint-production-image-build',
  'tracepoint-production-runtime',
  'tracepoint-production-request-controls',
  'tracepoint-production-alert-delivery',
];

export function resourcesOf(template, type) {
  return Object.values(template.Resources ?? {}).filter(resource => resource.Type === type);
}

function retained(resources, label) {
  assert.ok(resources.length > 0, `${label} is absent`);
  for (const resource of resources) {
    assert.equal(resource.DeletionPolicy, 'Retain', `${label} must be retained`);
    assert.equal(resource.UpdateReplacePolicy, 'Retain', `${label} replacement must be retained`);
  }
}

export function validateProductionRecoveryAssembly({manifest, templates}) {
  for (const stack of expectedStacks) {
    const artifact = manifest.artifacts?.[stack];
    assert.equal(artifact?.type, 'aws:cloudformation:stack', `${stack} stack artifact is absent`);
    assert.equal(artifact.properties?.terminationProtection, true, `${stack} termination protection is disabled`);
    assert.equal(artifact.environment, 'aws://111111111111/us-east-1', `${stack} preview target drifted`);
    assert.ok(templates[stack], `${stack} template is absent`);
  }

  const compute = templates['tracepoint-production-compute'];
  const build = templates['tracepoint-production-image-build'];
  const runtime = templates['tracepoint-production-runtime'];
  const requests = templates['tracepoint-production-request-controls'];
  const alerts = templates['tracepoint-production-alert-delivery'];
  const security = templates['tracepoint-production-security'];

  const repositories = resourcesOf(compute, 'AWS::ECR::Repository');
  retained(repositories, 'production ECR repository');
  assert.equal(repositories[0].Properties.ImageTagMutability, 'IMMUTABLE');
  assert.equal(repositories[0].Properties.ImageScanningConfiguration?.ScanOnPush, true);
  retained(resourcesOf(compute, 'AWS::SecretsManager::Secret'), 'production application secret');
  retained(resourcesOf(compute, 'AWS::Logs::LogGroup'), 'production application log group');
  assert.deepEqual(resourcesOf(compute, 'AWS::ECS::Cluster')[0]?.Properties.ClusterSettings, [{Name:'containerInsights',Value:'enhanced'}]);
  retained(resourcesOf(security, 'AWS::KMS::Key'), 'production data key');

  const sourceBuckets = resourcesOf(build, 'AWS::S3::Bucket');
  retained(sourceBuckets, 'production build and access-log buckets');
  assert.equal(sourceBuckets.filter(bucket => bucket.Properties.VersioningConfiguration?.Status === 'Enabled').length, 1, 'Exactly one versioned production build source bucket is required');
  assert.equal(sourceBuckets.filter(bucket => bucket.Properties.LoggingConfiguration?.DestinationBucketName).length, 1, 'Production build source access logging is required');
  retained(resourcesOf(build, 'AWS::Logs::LogGroup'), 'production build log group');
  assert.ok(resourcesOf(build, 'AWS::CodeBuild::Project')[0]?.Properties.EncryptionKey, 'CodeBuild KMS artifact encryption is required');

  retained(resourcesOf(runtime, 'AWS::ECS::TaskDefinition'), 'production task definition');
  const services = resourcesOf(runtime, 'AWS::ECS::Service');
  assert.equal(services.length, 1);
  assert.equal(services[0].Properties.DesiredCount, 2);
  assert.deepEqual(services[0].Properties.DeploymentConfiguration?.DeploymentCircuitBreaker, {Enable:true,Rollback:true});
  const loadBalancers = resourcesOf(runtime, 'AWS::ElasticLoadBalancingV2::LoadBalancer');
  assert.ok(loadBalancers[0].Properties.LoadBalancerAttributes.some(attribute => attribute.Key === 'deletion_protection.enabled' && attribute.Value === 'true'));
  assert.ok(loadBalancers[0].Properties.LoadBalancerAttributes.some(attribute => attribute.Key === 'access_logs.s3.enabled' && attribute.Value === 'true'));
  retained(resourcesOf(runtime, 'AWS::S3::Bucket'), 'production ALB access-log bucket');
  assert.equal(resourcesOf(runtime, 'AWS::CloudWatch::Alarm').length, 6);
  const runtimeText = JSON.stringify(runtime);
  for (const provider of ['TRACEPOINT_DATA_PROVIDER","Value":"supabase','TRACEPOINT_EMAIL_PROVIDER","Value":"brevo','TRACEPOINT_STORAGE_PROVIDER","Value":"supabase']) assert.ok(runtimeText.includes(provider), `initial provider pin missing: ${provider}`);
  assert.equal(resourcesOf(runtime, 'AWS::RDS::DBInstance').length, 0);
  assert.equal(resourcesOf(runtime, 'AWS::RDS::DBCluster').length, 0);
  assert.equal(resourcesOf(runtime, 'AWS::DynamoDB::Table').length, 0);

  retained(resourcesOf(requests, 'AWS::WAFv2::WebACL'), 'production web ACL');
  const webAclText = JSON.stringify(resourcesOf(requests, 'AWS::WAFv2::WebACL'));
  assert.ok(webAclText.includes('RequestFlood'));
  assert.ok(webAclText.includes('ResponseCode":429'));
  assert.ok(!webAclText.includes('SyntheticRateProbe'));
  retained(resourcesOf(requests, 'AWS::Logs::LogGroup'), 'production WAF log group');

  retained(resourcesOf(alerts, 'AWS::SQS::Queue'), 'production alert queues');
  assert.equal(resourcesOf(alerts, 'AWS::SNS::Subscription').length, 1);
  const compositeText = JSON.stringify(resourcesOf(alerts, 'AWS::CloudWatch::CompositeAlarm'));
  assert.ok(compositeText.includes('tracepoint-production-cpu'));
  assert.ok(compositeText.includes('tracepoint-production-latency-p99'));

  return {
    validatedStackCount: expectedStacks.length,
    hostingRecoveryPlan: 'validated-offline',
    immutableRuntimeRollback: true,
    retainedControlPlaneArtifacts: true,
    initialCustomerDataProvider: 'production-supabase',
    productionCustomerDataMutated: false,
    productionPitrValidated: false,
  };
}
