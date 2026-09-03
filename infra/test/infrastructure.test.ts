import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ComputeFoundationStack } from "../lib/compute-foundation-stack";
import { NetworkStack } from "../lib/network-stack";
import { RuntimeStack } from "../lib/runtime-stack";
import { SecurityStack } from "../lib/security-stack";

const env = { account: "559054714699", region: "us-east-1" };

function foundations() {
  const app = new cdk.App();
  app.node.setContext(
    "availability-zones:account=559054714699:region=us-east-1",
    ["us-east-1a", "us-east-1b"],
  );
  const network = new NetworkStack(app, "network", {
    env,
    environmentName: "staging",
  });
  const security = new SecurityStack(app, "security", {
    env,
    environmentName: "staging",
  });
  const compute = new ComputeFoundationStack(app, "compute", {
    env,
    environmentName: "staging",
    vpc: network.vpc,
    dataKey: security.dataKey,
  });
  return { app, network, security, compute };
}

test("lean network has public subnets, flow logs, and no NAT gateway", () => {
  const { network } = foundations();
  const template = Template.fromStack(network);
  template.resourceCountIs("AWS::EC2::NatGateway", 0);
  template.resourceCountIs("AWS::EC2::FlowLog", 1);
  template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
    VpcEndpointType: "Gateway",
    ServiceName: Match.anyValue(),
  });
});

test("foundation retains encrypted immutable assets and an idle cluster", () => {
  const { compute } = foundations();
  const template = Template.fromStack(compute);
  template.hasResourceProperties("AWS::ECR::Repository", {
    EncryptionConfiguration: { EncryptionType: "KMS" },
    ImageScanningConfiguration: { ScanOnPush: true },
    ImageTagMutability: "IMMUTABLE",
  });
  template.hasResourceProperties("AWS::Logs::LogGroup", {
    RetentionInDays: 30,
    KmsKeyId: Match.anyValue(),
  });
  template.resourceCountIs("AWS::ECS::Service", 0);
});

test("execution IAM is resource-scoped and task IAM has no permissions", () => {
  const { compute } = foundations();
  const template = Template.fromStack(compute);
  const policies = template.findResources("AWS::IAM::Policy");
  const serialized = JSON.stringify(policies);
  assert.match(serialized, /BatchGetImage/);
  assert.doesNotMatch(serialized, /AmazonECSTaskExecutionRolePolicy/);
  assert.equal((serialized.match(/GetAuthorizationToken/g) ?? []).length, 1);
  assert.equal(Object.keys(policies).length, 1);
  assert.match(serialized, /AppRepository/);
  assert.match(serialized, /AppLogGroup/);
  assert.match(serialized, /AppSecrets/);
});

test("runtime is single-task, rollback-enabled, TLS-only, and pins providers", () => {
  const { app, network, compute } = foundations();
  const runtime = new RuntimeStack(app, "runtime", {
    env,
    environmentName: "staging",
    vpc: network.vpc,
    repository: compute.repository,
    cluster: compute.cluster,
    appLogGroup: compute.appLogGroup,
    appSecrets: compute.appSecrets,
    executionRole: compute.executionRole,
    taskRole: compute.taskRole,
    certificateArn: "arn:aws:acm:us-east-1:559054714699:certificate/00000000-0000-4000-8000-000000000000",
    imageTag: "0123456789abcdef",
  });
  const template = Template.fromStack(runtime);
  template.hasResourceProperties("AWS::ECS::Service", {
    DesiredCount: 1,
    DeploymentConfiguration: {
      DeploymentCircuitBreaker: { Enable: true, Rollback: true },
    },
    NetworkConfiguration: {
      AwsvpcConfiguration: { AssignPublicIp: "ENABLED" },
    },
  });
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    Cpu: "256",
    Memory: "512",
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Environment: Match.arrayWith([
          { Name: "TRACEPOINT_DATA_PROVIDER", Value: "supabase" },
          { Name: "TRACEPOINT_EMAIL_PROVIDER", Value: "brevo" },
          { Name: "TRACEPOINT_STORAGE_PROVIDER", Value: "supabase" },
        ]),
      }),
    ]),
  });
  template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 2);
  template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
});
