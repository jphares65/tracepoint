import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { fullAwsProductionAssembly } from "../lib/full-aws-production-assembly";
import { validateFullAwsProductionTarget, type FullAwsProductionTarget } from "../lib/full-aws-production-target";

const target:FullAwsProductionTarget={account:"111111111111",region:"us-east-1",roleArn:"arn:aws:iam::111111111111:role/TracePointMigrationProduction",hostname:"tracepointhq.com",certificateArn:"arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-4000-8000-000000000000",imageTag:"a".repeat(40)+"-aws-native",imageDigest:"sha256:"+"b".repeat(64),architectureTarget:"full-aws",deploymentPhase:"full-aws-final",dataMode:"aws-postgres-authoritative",authMode:"cognito",storageMode:"s3",emailMode:"ses",databaseTopology:"aurora-serverless-v2",desiredCount:2,maxCapacity:4,humanAlertEmail:"contact@tracepointhq.com"};

test("full-AWS production target rejects hybrid and unapproved live operation",()=>{
 validateFullAwsProductionTarget(target,{offline:true});
 assert.throws(()=>validateFullAwsProductionTarget(target));
 for(const change of [{deploymentPhase:"temporary-provider-bridge"},{dataMode:"retain-production-providers"},{authMode:"supabase"},{storageMode:"supabase"},{emailMode:"brevo"},{architectureTarget:"hybrid"},{databaseTopology:"supabase"},{imageDigest:"latest"},{humanAlertEmail:"other@tracepointhq.com"}])assert.throws(()=>validateFullAwsProductionTarget({...target,...change} as FullAwsProductionTarget,{offline:true}));
});

test("full-AWS production assembly composes native providers backup and exact task database ingress",()=>{
 const stacks=fullAwsProductionAssembly(new cdk.App(),target,true);
 assert.equal(stacks.network.stackName,"tracepoint-production-network");
 assert.equal(stacks.security.stackName,"tracepoint-production-security");
 assert.equal(stacks.compute.stackName,"tracepoint-production-compute");
 assert.equal(stacks.imageBuild.stackName,"tracepoint-production-image-build");
 assert.equal(stacks.runtime.stackName,"tracepoint-production-runtime");
 assert.equal(stacks.requestControls.stackName,"tracepoint-production-request-controls");
 assert.equal(stacks.alerts.stackName,"tracepoint-production-alert-delivery");
 const runtime=Template.fromStack(stacks.runtime),database=Template.fromStack(stacks.database),backup=Template.fromStack(stacks.backup),auth=Template.fromStack(stacks.cognito),email=Template.fromStack(stacks.ses),storage=Template.fromStack(stacks.storage),feedback=Template.fromStack(stacks.sesFeedbackWorker);
 const serialized=JSON.stringify(runtime.toJSON());
 for(const value of ["postgres","cognito","s3","ses","TRACEPOINT_DATABASE_SECRET_JSON"])assert.match(serialized,new RegExp(value));
 assert.doesNotMatch(serialized,/NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET|BREVO_API_KEY|\"Value\":\"supabase\"|\"Value\":\"brevo\"/);
 runtime.hasResourceProperties("AWS::EC2::SecurityGroupIngress",{IpProtocol:"tcp",FromPort:5432,ToPort:5432,GroupId:Match.anyValue(),SourceSecurityGroupId:Match.anyValue()});
 database.hasResourceProperties("AWS::RDS::DBCluster",{Engine:"aurora-postgresql",StorageEncrypted:true,DeletionProtection:true,BackupRetentionPeriod:35});
 database.resourceCountIs("AWS::RDS::DBInstance",2);
 backup.hasResourceProperties("AWS::Backup::BackupVault",{BackupVaultName:"tracepoint-production"});
 auth.hasResourceProperties("AWS::Cognito::UserPool",{DeletionProtection:"ACTIVE"});
 email.hasResourceProperties("AWS::SES::ConfigurationSet",{Name:"tracepoint-production"});
 feedback.hasResourceProperties("AWS::Lambda::EventSourceMapping",{FunctionResponseTypes:["ReportBatchItemFailures"]});
 storage.hasResourceProperties("AWS::S3::Bucket",{BucketName:"tracepoint-production-private-111111111111",VersioningConfiguration:{Status:"Enabled"},PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},BucketEncryption:{ServerSideEncryptionConfiguration:[{BucketKeyEnabled:true,ServerSideEncryptionByDefault:{SSEAlgorithm:"aws:kms",KMSMasterKeyID:Match.anyValue()}}]},LoggingConfiguration:Match.objectLike({LogFilePrefix:"objects/"})});
 const storagePolicies=JSON.stringify(storage.findResources("AWS::IAM::Policy"));
 for(const permission of ["s3:GetObject","s3:PutObject","s3:DeleteObject","kms:Decrypt","kms:GenerateDataKey","kms:ViaService"])assert.match(storagePolicies,new RegExp(permission));
 assert.doesNotMatch(storagePolicies,/s3:\*|s3:ListBucket|s3:DeleteObjectVersion/);
 for(const stack of Object.values(stacks))for(const role of Object.values(Template.fromStack(stack).findResources("AWS::IAM::Role")))assert.match(JSON.stringify(role.Properties.PermissionsBoundary),/TracePointProductionBoundary/);
});

test("production database assembly also supports the documented Multi-AZ RDS choice",()=>{
 const stacks=fullAwsProductionAssembly(new cdk.App(),{...target,databaseTopology:"rds-multi-az"},true),database=Template.fromStack(stacks.database);
 database.hasResourceProperties("AWS::RDS::DBInstance",{Engine:"postgres",MultiAZ:true,PubliclyAccessible:false,StorageEncrypted:true,DeletionProtection:true,BackupRetentionPeriod:35});
 database.resourceCountIs("AWS::RDS::DBCluster",0);
});

test("initial-production proposal is single-AZ and right-sized without removing recovery or security controls",()=>{
 const initial={...target,databaseTopology:"rds-single-az" as const,desiredCount:1 as const,maxCapacity:2 as const};
 const stacks=fullAwsProductionAssembly(new cdk.App(),initial,true);
 const database=Template.fromStack(stacks.database),runtime=Template.fromStack(stacks.runtime),compute=Template.fromStack(stacks.compute),feedback=Template.fromStack(stacks.sesFeedbackWorker),backup=Template.fromStack(stacks.backup),network=Template.fromStack(stacks.network),security=Template.fromStack(stacks.security),alerts=Template.fromStack(stacks.alerts);
 database.hasResourceProperties("AWS::RDS::DBInstance",{DBInstanceClass:"db.t4g.small",AllocatedStorage:"20",MaxAllocatedStorage:100,MultiAZ:false,PubliclyAccessible:false,StorageEncrypted:true,DeletionProtection:true,BackupRetentionPeriod:35,DeleteAutomatedBackups:false});
 runtime.hasResourceProperties("AWS::ECS::Service",{DesiredCount:1,DeploymentConfiguration:Match.objectLike({MaximumPercent:200,MinimumHealthyPercent:100})});
 const services=Object.values(runtime.findResources("AWS::ECS::Service")) as Array<{Properties:{NetworkConfiguration:{AwsvpcConfiguration:{Subnets:unknown[]}}}}>;
 assert.equal(services[0].Properties.NetworkConfiguration.AwsvpcConfiguration.Subnets.length,1);
 compute.hasResourceProperties("AWS::ECS::Cluster",{ClusterSettings:[{Name:"containerInsights",Value:"disabled"}]});
 compute.hasResourceProperties("AWS::Logs::LogGroup",{RetentionInDays:90});
 network.hasResourceProperties("AWS::Logs::LogGroup",{LogGroupName:"/tracepoint/production/network/vpc-flow",KmsKeyId:Match.anyValue(),RetentionInDays:90});
 database.hasResourceProperties("AWS::Logs::LogGroup",{LogGroupName:"/aws/rds/instance/tracepoint-production/postgresql",KmsKeyId:Match.anyValue(),RetentionInDays:90});
 feedback.hasResourceProperties("AWS::Logs::LogGroup",{LogGroupName:"/tracepoint/production/ses-feedback-worker",KmsKeyId:Match.anyValue(),RetentionInDays:90});
 for(const alarm of Object.values(database.findResources("AWS::CloudWatch::Alarm")))assert.equal(alarm.Properties.TreatMissingData,"breaching");
 for(const alarm of Object.values(feedback.findResources("AWS::CloudWatch::Alarm")))assert.equal(alarm.Properties.TreatMissingData,"notBreaching");
 database.hasResourceProperties("AWS::CloudWatch::Alarm",{AlarmName:"tracepoint-production-database-connections",Threshold:50,TreatMissingData:"breaching"});
 backup.hasResourceProperties("AWS::Backup::BackupVault",{BackupVaultName:"tracepoint-production",LockConfiguration:{MinRetentionDays:35,MaxRetentionDays:365}});
 assert.match(JSON.stringify(security.findResources("AWS::KMS::Key")),/network\/vpc-flow/);
 alerts.hasResourceProperties("AWS::SNS::Subscription",{Protocol:"email",Endpoint:"contact@tracepointhq.com"});
 for(const endpoint of Object.values(feedback.findResources("AWS::EC2::VPCEndpoint")) as Array<{Properties:{SubnetIds:unknown[]}}>)assert.equal(endpoint.Properties.SubnetIds.length,1);
 backup.hasResourceProperties("AWS::Backup::BackupPlan",Match.anyValue());
 assert.throws(()=>validateFullAwsProductionTarget({...initial,desiredCount:2,maxCapacity:4},{offline:true}));
});
