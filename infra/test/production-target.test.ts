import {test} from 'node:test';import {strict as assert} from 'node:assert';import * as cdk from 'aws-cdk-lib';import {Template,Match} from 'aws-cdk-lib/assertions';import {validateProductionTarget,verifyProductionIdentity,type ProductionTarget} from '../lib/production-target';import {productionAssembly} from '../lib/production-assembly';
const target:ProductionTarget={account:'222222222222',region:'us-east-1',roleArn:'arn:aws:iam::222222222222:role/TracePointMigrationProduction',hostname:'tracepointhq.com',certificateArn:'arn:aws:acm:us-east-1:222222222222:certificate/00000000-0000-4000-8000-000000000000',imageTag:'a'.repeat(40),emailFromAddress:'contact@tracepointhq.com',dataMode:'retain-production-providers',desiredCount:2,maxCapacity:4};
function authorized(){return {...target,deploymentAuthorization:{account:target.account,roleArn:target.roleArn,expiresAt:new Date(Date.now()+3600000).toISOString(),reference:'synthetic-unit-test-approval'}};}
test('production target rejects absent authority and forbidden targets',()=>{
 validateProductionTarget(target,{offline:true});assert.throws(()=>validateProductionTarget(target));validateProductionTarget(authorized());
 for(const change of [{account:'559054714699'},{account:'265544358665'},{account:'111111111111'},{region:'us-west-2'},{hostname:'staging.tracepointhq.com'},{dataMode:'copy-production'},{desiredCount:1},{maxCapacity:20},{emailFromAddress:'contact@staging.tracepointhq.com'},{certificateArn:target.certificateArn.replace(target.account,'559054714699')},{imageTag:'latest'}])assert.throws(()=>validateProductionTarget({...authorized(),...change} as ProductionTarget));
 for(const expiresAt of ['invalid',new Date(Date.now()-1000).toISOString(),new Date(Date.now()+90000000).toISOString()]){const t=authorized();t.deploymentAuthorization.expiresAt=expiresAt;assert.throws(()=>validateProductionTarget(t));}
});
test('production identity rejects wrong role account and region',()=>{
 const t=authorized(),identity={Account:t.account,Arn:'arn:aws:sts::'+t.account+':assumed-role/TracePointMigrationProduction/synthetic'};verifyProductionIdentity(t,identity,'us-east-1');
 for(const bad of [{...identity,Account:'559054714699'},{...identity,Arn:identity.Arn.replace('Production/','ProductionExtra/')},{...identity,Arn:identity.Arn.replace('222222222222','265544358665')}])assert.throws(()=>verifyProductionIdentity(t,bad,'us-east-1'));assert.throws(()=>verifyProductionIdentity(t,identity,'us-west-2'));
});
test('production assembly retains provider isolation and two-to-four capacity',()=>{
 const stacks=productionAssembly(new cdk.App(),target,true),runtime=Template.fromStack(stacks.runtime),compute=Template.fromStack(stacks.compute);
 runtime.hasResourceProperties('AWS::ECS::Service',{DesiredCount:2,DeploymentConfiguration:{DeploymentCircuitBreaker:{Enable:true,Rollback:true}}});runtime.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget',{MinCapacity:2,MaxCapacity:4});
 runtime.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer',{LoadBalancerAttributes:Match.arrayWith([{Key:'deletion_protection.enabled',Value:'true'}])});
 runtime.hasResourceProperties('AWS::ECS::TaskDefinition',{ContainerDefinitions:Match.arrayWith([Match.objectLike({Environment:Match.arrayWith([{Name:'TRACEPOINT_EMAIL_PROVIDER',Value:'brevo'},{Name:'TRACEPOINT_FROM_EMAIL',Value:'contact@tracepointhq.com'},{Name:'TRACEPOINT_STORAGE_PROVIDER',Value:'supabase'}])})])});
 compute.hasResourceProperties('AWS::SecretsManager::Secret',{Name:'tracepoint/production/application'});compute.hasResourceProperties('AWS::Logs::LogGroup',{RetentionInDays:365});compute.hasResource('AWS::SecretsManager::Secret',{DeletionPolicy:'Retain'});assert.equal(stacks.runtime.terminationProtection,true);
});
