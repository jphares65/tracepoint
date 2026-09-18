import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import {NetworkStack} from './network-stack';import {SecurityStack} from './security-stack';import {ComputeFoundationStack} from './compute-foundation-stack';import {ImageBuildStack} from './image-build-stack';import {RuntimeStack} from './runtime-stack';import {RequestControlsStack} from './request-controls-stack';import {AlertDeliveryStack} from './alert-delivery-stack';import {validateProductionTarget,type ProductionTarget} from './production-target';
export function productionAssembly(app:cdk.App,input:ProductionTarget,offline:boolean){
 const target=validateProductionTarget(input,{offline});const env={account:target.account,region:target.region};
 app.node.setContext('availability-zones:account='+target.account+':region='+target.region,['us-east-1a','us-east-1b']);
 const common={env,environmentName:'production',terminationProtection:true,description:offline?'TracePoint temporary production bridge preview; final target is full AWS':'TracePoint temporary production hosting bridge; retained providers are not the final architecture',tags:{Application:'TracePoint',Environment:'production',Owner:'TracePoint',ManagedBy:'AWS-CDK',CostCenter:'TracePoint-Production',DataClassification:'PublicSafety-Sensitive',ArchitectureTarget:'full-aws',MigrationPhase:'temporary-provider-bridge'}};
 const network=new NetworkStack(app,'tracepoint-production-network',common);
 const security=new SecurityStack(app,'tracepoint-production-security',common);security.addStackDependency(network);
 const compute=new ComputeFoundationStack(app,'tracepoint-production-compute',{...common,vpc:network.vpc,dataKey:security.dataKey,logRetention:cdk.aws_logs.RetentionDays.ONE_YEAR});compute.addStackDependency(network);compute.addStackDependency(security);
 const build=new ImageBuildStack(app,'tracepoint-production-image-build',{...common,repository:compute.repository,appSecrets:compute.appSecrets,productionControls:true});build.addStackDependency(compute);
 const runtime=new RuntimeStack(app,'tracepoint-production-runtime',{...common,vpc:network.vpc,repository:compute.repository,cluster:compute.cluster,appLogGroup:compute.appLogGroup,appSecrets:compute.appSecrets,executionRole:compute.executionRole,taskRole:compute.taskRole,certificateArn:target.certificateArn,imageTag:target.imageTag,emailFromAddress:target.emailFromAddress,desiredCount:2,maxCapacity:4,deletionProtection:true,productionControls:true});runtime.addStackDependency(network);runtime.addStackDependency(compute);
 const requestControls=new RequestControlsStack(app,'tracepoint-production-request-controls',{...common,environment:'production',expectedAccount:target.account,loadBalancerArn:runtime.loadBalancerArn,mode:'enforce'});requestControls.addStackDependency(runtime);
 const alertDelivery=new AlertDeliveryStack(app,'tracepoint-production-alert-delivery',{...common,environment:'production',expectedAccount:target.account,humanEmailAddress:target.emailFromAddress});alertDelivery.addStackDependency(runtime);alertDelivery.addStackDependency(requestControls);
 for(const stack of [network,security,compute,build,runtime,requestControls,alertDelivery]){
  const boundary=iam.ManagedPolicy.fromManagedPolicyArn(stack,'ProductionPermissionsBoundary',stack.formatArn({service:'iam',region:'',resource:'policy',resourceName:'TracePointProductionBoundary'}));
  iam.PermissionsBoundary.of(stack).apply(boundary);
 }
 return {network,security,compute,build,runtime,requestControls,alertDelivery};
}
