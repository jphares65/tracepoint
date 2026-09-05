import * as cdk from 'aws-cdk-lib';
import {NetworkStack} from './network-stack';import {SecurityStack} from './security-stack';import {ComputeFoundationStack} from './compute-foundation-stack';import {ImageBuildStack} from './image-build-stack';import {RuntimeStack} from './runtime-stack';import {validateProductionTarget,type ProductionTarget} from './production-target';
export function productionAssembly(app:cdk.App,input:ProductionTarget,offline:boolean){
 const target=validateProductionTarget(input,{offline});const env={account:target.account,region:target.region};
 app.node.setContext('availability-zones:account='+target.account+':region='+target.region,['us-east-1a','us-east-1b']);
 const common={env,environmentName:'production',terminationProtection:true,description:offline?'TracePoint production offline preview; not deployment authorization':'TracePoint production hosting with retained production providers',tags:{Application:'TracePoint',Environment:'production',Owner:'TracePoint',ManagedBy:'AWS-CDK',CostCenter:'TracePoint-Production',DataClassification:'PublicSafety-Sensitive'}};
 const network=new NetworkStack(app,'tracepoint-production-network',common);
 const security=new SecurityStack(app,'tracepoint-production-security',common);security.addStackDependency(network);
 const compute=new ComputeFoundationStack(app,'tracepoint-production-compute',{...common,vpc:network.vpc,dataKey:security.dataKey,logRetention:cdk.aws_logs.RetentionDays.ONE_YEAR});compute.addStackDependency(network);compute.addStackDependency(security);
 const build=new ImageBuildStack(app,'tracepoint-production-image-build',{...common,repository:compute.repository,appSecrets:compute.appSecrets});build.addStackDependency(compute);
 const runtime=new RuntimeStack(app,'tracepoint-production-runtime',{...common,vpc:network.vpc,repository:compute.repository,cluster:compute.cluster,appLogGroup:compute.appLogGroup,appSecrets:compute.appSecrets,executionRole:compute.executionRole,taskRole:compute.taskRole,certificateArn:target.certificateArn,imageTag:target.imageTag,emailFromAddress:target.emailFromAddress,desiredCount:2,maxCapacity:4,deletionProtection:true});runtime.addStackDependency(network);runtime.addStackDependency(compute);
 return {network,security,compute,build,runtime};
}
