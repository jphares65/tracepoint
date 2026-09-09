import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { NetworkStack } from "./network-stack";
import { SecurityStack } from "./security-stack";
import { ComputeFoundationStack } from "./compute-foundation-stack";
import { ImageBuildStack } from "./image-build-stack";
import { PrivateStorageStack } from "./private-storage-stack";
import { ProductionDatabaseStack } from "./production-database-stack";
import { CognitoFoundationStack } from "./cognito-foundation-stack";
import { SesFoundationStack } from "./ses-foundation-stack";
import { RuntimeStack } from "./runtime-stack";
import { RequestControlsStack } from "./request-controls-stack";
import { AlertDeliveryStack } from "./alert-delivery-stack";
import { BackupRecoveryStack } from "./backup-recovery-stack";
import { validateFullAwsProductionTarget, type FullAwsProductionTarget } from "./full-aws-production-target";

export function fullAwsProductionAssembly(app:cdk.App,input:FullAwsProductionTarget,offline:boolean){
 const target=validateFullAwsProductionTarget(input,{offline}),env={account:target.account,region:target.region};
 app.node.setContext(`availability-zones:account=${target.account}:region=${target.region}`,["us-east-1a","us-east-1b"]);
 const common={env,environmentName:"production" as const,terminationProtection:true,description:offline?"TracePoint full-AWS production offline preview":"TracePoint full-AWS production target",tags:{Application:"TracePoint",Environment:"production",Owner:"TracePoint",ManagedBy:"AWS-CDK",CostCenter:"TracePoint-Production",DataClassification:"PublicSafety-Sensitive",ArchitectureTarget:"full-aws",MigrationPhase:"full-aws-final"}};
 const network=new NetworkStack(app,"tracepoint-production-full-aws-network",common);
 const security=new SecurityStack(app,"tracepoint-production-full-aws-security",common);security.addStackDependency(network);
 const compute=new ComputeFoundationStack(app,"tracepoint-production-full-aws-compute",{...common,vpc:network.vpc,dataKey:security.dataKey,logRetention:cdk.aws_logs.RetentionDays.ONE_YEAR});compute.addStackDependency(network);compute.addStackDependency(security);
 const imageBuild=new ImageBuildStack(app,"tracepoint-production-full-aws-image-build",{...common,repository:compute.repository,appSecrets:compute.appSecrets,providerMode:"aws-native",productionControls:true});imageBuild.addStackDependency(compute);
 const storage=new PrivateStorageStack(app,"tracepoint-production-full-aws-storage",{...common,taskRole:compute.taskRole});storage.addStackDependency(compute);
 const database=new ProductionDatabaseStack(app,"tracepoint-production-full-aws-database",{...common,topology:target.databaseTopology,vpc:network.vpc,dataKey:security.dataKey,securityGroup:network.databaseSecurityGroup});database.addStackDependency(network);database.addStackDependency(security);
 const ses=new SesFoundationStack(app,"tracepoint-production-full-aws-ses",{...common,mailFromSubdomain:"bounce",taskRole:compute.taskRole});ses.addStackDependency(compute);
 const cognito=new CognitoFoundationStack(app,"tracepoint-production-full-aws-cognito",{...common,taskRole:compute.taskRole,sesFromAddress:ses.fromAddress,sesConfigurationSetName:ses.configurationSetName});cognito.addStackDependency(compute);cognito.addStackDependency(ses);
 const backup=new BackupRecoveryStack(app,"tracepoint-production-full-aws-backup",common);backup.addStackDependency(database);backup.addStackDependency(storage);
 const runtime=new RuntimeStack(app,"tracepoint-production-full-aws-runtime",{...common,vpc:network.vpc,repository:compute.repository,cluster:compute.cluster,appLogGroup:compute.appLogGroup,appSecrets:compute.appSecrets,executionRole:compute.executionRole,taskRole:compute.taskRole,certificateArn:target.certificateArn,imageTag:target.imageTag,emailFromAddress:ses.fromAddress,storageBucketName:storage.bucket.bucketName,providerMode:"aws-native",databaseSecret:database.runtimeSecret,databaseSecurityGroup:network.databaseSecurityGroup,cognitoUserPoolId:cognito.userPool.userPoolId,cognitoClientId:cognito.userPoolClient.userPoolClientId,sesConfigurationSet:ses.configurationSetName,desiredCount:target.desiredCount,maxCapacity:target.maxCapacity,deletionProtection:true,productionControls:true});
 for(const dependency of [network,compute,storage,database,cognito,ses])runtime.addStackDependency(dependency);
 const requestControls=new RequestControlsStack(app,"tracepoint-production-full-aws-request-controls",{...common,environment:"production",expectedAccount:target.account,loadBalancerArn:runtime.loadBalancerArn,mode:"enforce"});requestControls.addStackDependency(runtime);
 const alerts=new AlertDeliveryStack(app,"tracepoint-production-full-aws-alert-delivery",{...common,environment:"production",expectedAccount:target.account,humanEmailAddress:target.humanAlertEmail});alerts.addStackDependency(runtime);alerts.addStackDependency(requestControls);
 const stacks=[network,security,compute,imageBuild,storage,database,cognito,ses,backup,runtime,requestControls,alerts];
 for(const stack of stacks){const boundary=iam.ManagedPolicy.fromManagedPolicyArn(stack,"ProductionPermissionsBoundary",stack.formatArn({service:"iam",region:"",resource:"policy",resourceName:"TracePointProductionBoundary"}));iam.PermissionsBoundary.of(stack).apply(boundary);}
 return {network,security,compute,imageBuild,storage,database,cognito,ses,backup,runtime,requestControls,alerts};
}
