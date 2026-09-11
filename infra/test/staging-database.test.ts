import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { StagingDatabaseStack } from "../lib/staging-database-stack";
import { BackupRecoveryStack } from "../lib/backup-recovery-stack";

test("staging PostgreSQL is private, encrypted, TLS-only, backup-protected and bounded", () => {
  const app = new cdk.App();
  app.node.setContext("availability-zones:account=559054714699:region=us-east-1", ["us-east-1a", "us-east-1b"]);
  const env = { account: "559054714699", region: "us-east-1" };
  const network = new NetworkStack(app, "network", { env, environmentName: "staging" });
  const security = new SecurityStack(app, "security", { env, environmentName: "staging" });
  const stack = new StagingDatabaseStack(app, "database", {
    env, environmentName: "staging", vpc: network.vpc, dataKey: security.dataKey,
    securityGroup: network.databaseSecurityGroup,
    expiresAfterUtc: new Date(Date.now()+2*86400000).toISOString(),
    leaseOwner: "synthetic-test-owner",
    leaseReference: "unit-test-lease",
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    Engine: "postgres", EngineVersion: "18.4", DBInstanceClass: "db.t4g.micro",
    AllocatedStorage: "20", MaxAllocatedStorage: 20, StorageType: "gp3",
    StorageEncrypted: true, PubliclyAccessible: false, MultiAZ: false,
    BackupRetentionPeriod: 1, DeletionProtection: true, DeleteAutomatedBackups: false,
    EnablePerformanceInsights: false,
  });
  template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
    Family: "postgres18", Parameters: Match.objectLike({ "rds.force_ssl": "1" }),
  });
  template.hasResourceProperties("AWS::SecretsManager::Secret", {
    Name: "tracepoint/staging/database/runtime",
    GenerateSecretString: Match.objectLike({ GenerateStringKey: "password", PasswordLength: 40 }),
  });
  assert.equal(template.findResources("AWS::EC2::NatGateway") && Object.keys(template.findResources("AWS::EC2::NatGateway")).length, 0);
  template.hasResourceProperties("AWS::RDS::DBInstance", { Tags: Match.arrayWith([{ Key: "Backup", Value: "daily" }]) });
});

test("staging backup retains an encrypted vault and selects daily-tagged resources", () => {
  const stack = new BackupRecoveryStack(new cdk.App(), "backup", { env: { account: "559054714699", region: "us-east-1" }, environmentName: "staging" });
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::Backup::BackupVault", { BackupVaultName: "tracepoint-staging", EncryptionKeyArn: Match.anyValue() });
  template.hasResourceProperties("AWS::Backup::BackupPlan", { BackupPlan: Match.objectLike({ BackupPlanName: "tracepoint-staging" }) });
  template.hasResourceProperties("AWS::Backup::BackupSelection", { BackupSelection: Match.objectLike({ ListOfTags: Match.arrayWith([Match.objectLike({ ConditionKey: "Backup", ConditionType: "STRINGEQUALS", ConditionValue: "daily" })]) }) });
});

test("staging database lease rejects stale, indefinite, or anonymous configuration", () => {
  const app = new cdk.App(); app.node.setContext("availability-zones:account=559054714699:region=us-east-1", ["us-east-1a", "us-east-1b"]);
  const env={account:"559054714699",region:"us-east-1"}; const network=new NetworkStack(app,"n",{env,environmentName:"staging"}); const security=new SecurityStack(app,"s",{env,environmentName:"staging"});
  for(const props of [{expiresAfterUtc:new Date(Date.now()+8*86400000).toISOString(),leaseOwner:"owner",leaseReference:"ref"},{expiresAfterUtc:new Date(Date.now()+86400000).toISOString(),leaseOwner:"",leaseReference:"ref"}])assert.throws(()=>new StagingDatabaseStack(app,`d${Math.random()}`,{env,environmentName:"staging",vpc:network.vpc,dataKey:security.dataKey,securityGroup:network.databaseSecurityGroup,...props}));
});
