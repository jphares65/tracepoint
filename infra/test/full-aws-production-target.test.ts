import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { fullAwsProductionAssembly } from "../lib/full-aws-production-assembly";
import { validateFullAwsProductionTarget, type FullAwsProductionTarget } from "../lib/full-aws-production-target";

const target:FullAwsProductionTarget={account:"111111111111",region:"us-east-1",roleArn:"arn:aws:iam::111111111111:role/TracePointMigrationProduction",hostname:"tracepointhq.com",certificateArn:"arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-4000-8000-000000000000",imageTag:"a".repeat(40),architectureTarget:"full-aws",deploymentPhase:"full-aws-final",dataMode:"aws-postgres-authoritative",authMode:"cognito",storageMode:"s3",emailMode:"ses",databaseTopology:"aurora-serverless-v2",desiredCount:2,maxCapacity:4};

test("full-AWS production target rejects hybrid and unapproved live operation",()=>{
 validateFullAwsProductionTarget(target,{offline:true});
 assert.throws(()=>validateFullAwsProductionTarget(target));
 for(const change of [{deploymentPhase:"temporary-provider-bridge"},{dataMode:"retain-production-providers"},{authMode:"supabase"},{storageMode:"supabase"},{emailMode:"brevo"},{architectureTarget:"hybrid"},{databaseTopology:"supabase"}])assert.throws(()=>validateFullAwsProductionTarget({...target,...change} as FullAwsProductionTarget,{offline:true}));
});

test("full-AWS production assembly composes native providers backup and exact task database ingress",()=>{
 const stacks=fullAwsProductionAssembly(new cdk.App(),target,true);
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
