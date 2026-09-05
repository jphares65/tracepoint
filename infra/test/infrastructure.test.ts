import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ComputeFoundationStack } from "../lib/compute-foundation-stack";
import { ImageBuildStack } from "../lib/image-build-stack";
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

test("image builder uses encrypted tracked source and immutable staging ECR only", () => {
  const { app, compute } = foundations();
  const imageBuild = new ImageBuildStack(app, "image-build", {
    env,
    environmentName: "staging",
    repository: compute.repository,
    appSecrets: compute.appSecrets,
  });
  const template = Template.fromStack(imageBuild);
  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: Match.arrayWith([
        Match.objectLike({
          ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: "aws:kms" }),
        }),
      ]),
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    VersioningConfiguration: { Status: "Enabled" },
  });
  template.hasResourceProperties("AWS::CodeBuild::Project", {
    Name: "tracepoint-staging-image-build",
    Source: {
      Type: "S3",
      BuildSpec: "buildspec.staging-image.yml",
    },
    Environment: Match.objectLike({
      ComputeType: "BUILD_GENERAL1_SMALL",
      PrivilegedMode: true,
    }),
    Artifacts: { Type: "NO_ARTIFACTS" },
  });
  template.hasResourceProperties("AWS::KMS::Key", {
    EnableKeyRotation: true,
    KeyPolicy: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Principal: { Service: "logs.us-east-1.amazonaws.com" },
          Condition: {
            ArnEquals: {
              "kms:EncryptionContext:aws:logs:arn": Match.anyValue(),
            },
          },
        }),
      ]),
    }),
  });
  const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
  assert.match(policies, /source\/tracepoint-staging-source\.zip/);
  assert.match(policies, /GetAuthorizationToken/);
  assert.match(policies, /PutImage/);
  assert.match(policies, /DescribeImages/);
  assert.match(policies, /GetSecretValue/);
  const iamPolicies = template.findResources("AWS::IAM::Policy");
  const statements = Object.values(iamPolicies).flatMap((resource) =>
    resource.Properties.PolicyDocument.Statement,
  );
  const decrypt = statements.filter(
    (statement) =>
      [statement.Action].flat().includes("kms:Decrypt") &&
      statement.Condition?.StringEquals?.["kms:ViaService"] ===
        "secretsmanager.us-east-1.amazonaws.com",
  );
  assert.equal(decrypt.length, 1);
  assert.deepEqual(decrypt[0].Action, "kms:Decrypt");
  assert.match(decrypt[0].Resource["Fn::ImportValue"], /^security:.*DataKey.*Arn/);
  assert.deepEqual(decrypt[0].Condition.StringEquals, {
    "kms:ViaService": "secretsmanager.us-east-1.amazonaws.com",
  });
  assert.doesNotMatch(policies, /cloudformation:/i);
  assert.doesNotMatch(policies, /iam:PassRole/i);
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
          { Name: "TRACEPOINT_FROM_EMAIL", Value: "contact@tracepointhq.com" },
          { Name: "TRACEPOINT_STORAGE_PROVIDER", Value: "supabase" },
        ]),
      }),
    ]),
  });
  template.hasResource("AWS::ECS::TaskDefinition", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
  template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 2);
  template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
  assert.match(JSON.stringify(template.toJSON()), /CONFIGURATION_ENVIRONMENT/);
});

test("production template retains resources, scales two to four tasks, and separates providers", () => {
  const app = new cdk.App();
  const env = { account: "111111111111", region: "us-east-1" };
  app.node.setContext("availability-zones:account=111111111111:region=us-east-1", ["us-east-1a", "us-east-1b"]);
  const props = {env, environmentName:"production", terminationProtection:true};
  const network = new NetworkStack(app,"production-network",props);
  const security = new SecurityStack(app,"production-security",props);
  const compute = new ComputeFoundationStack(app,"production-compute",{...props,vpc:network.vpc,dataKey:security.dataKey,logRetention:cdk.aws_logs.RetentionDays.ONE_YEAR});
  const runtime = new RuntimeStack(app,"production-runtime",{...props,vpc:network.vpc,repository:compute.repository,cluster:compute.cluster,appLogGroup:compute.appLogGroup,appSecrets:compute.appSecrets,executionRole:compute.executionRole,taskRole:compute.taskRole,certificateArn:"arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-4000-8000-000000000000",imageTag:"6b0e3028f3e5e97d567de20c05637bb0cb64e7b7",desiredCount:2,maxCapacity:4,deletionProtection:true});
  const template = Template.fromStack(runtime);
  template.hasResourceProperties("AWS::ECS::Service",{DesiredCount:2});
  template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget",{MinCapacity:2,MaxCapacity:4});
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer",{LoadBalancerAttributes:Match.arrayWith([{Key:"deletion_protection.enabled",Value:"true"}])});
  Template.fromStack(compute).hasResourceProperties("AWS::Logs::LogGroup",{RetentionInDays:365});
  const serialized=JSON.stringify(template.toJSON());
  assert.doesNotMatch(serialized,/559054714699|wztqqqashilusoppddxi|tracepoint-staging/);
});
