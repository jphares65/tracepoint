import test from 'node:test';import assert from 'node:assert/strict';import {validateRuntimeTemplate} from './validate-runtime-template.mjs';
const commit='a'.repeat(40);
const old={Resources:{Task:{Type:'AWS::ECS::TaskDefinition',Properties:{ContainerDefinitions:[{Name:'tracepoint',Image:{'Fn::Join':['',['repository',':'+'b'.repeat(40)]]},ReadonlyRootFilesystem:true}]}},Service:{Type:'AWS::ECS::Service',Properties:{DesiredCount:1}}}};
function updated(){const t=structuredClone(old);t.Resources.Task.Properties.ContainerDefinitions[0].Image={'Fn::Join':['',['repository',':'+commit]]};return t;}
test('runtime release admits image-only replacement and additive alarms',()=>{
 const t=updated();t.Resources.Alarm={Type:'AWS::CloudWatch::Alarm',Properties:{Threshold:5}};assert.equal(validateRuntimeTemplate(old,t,commit).safe,true);
});
test('runtime release denies deletion, IAM additions, secret changes, count changes and wrong image tag',()=>{
 for(const mutate of [t=>delete t.Resources.Service,t=>t.Resources.Role={Type:'AWS::IAM::Role'},t=>t.Resources.Task.Properties.ContainerDefinitions[0].Secrets=[],t=>t.Resources.Service.Properties.DesiredCount=4,t=>t.Resources.Task.Properties.ContainerDefinitions[0].Image='latest',t=>t.Resources.Task.Properties.ContainerDefinitions[0].Image={'Fn::Join':['',['other-repository',':'+commit]]},t=>t.Parameters={unreviewed:{Type:'String'}}]){
  const t=updated();mutate(t);assert.throws(()=>validateRuntimeTemplate(old,t,commit));
 }
});

test('reviewed control gate admits only verified sender addition and retention',()=>{
 const t=updated();t.Resources.Task.Properties.ContainerDefinitions[0].Environment=[{Name:'TRACEPOINT_FROM_EMAIL',Value:'contact@tracepointhq.com'}];
 t.Resources.Task.DeletionPolicy='Retain';t.Resources.Task.UpdateReplacePolicy='Retain';
 assert.throws(()=>validateRuntimeTemplate(old,t,commit));
 assert.equal(validateRuntimeTemplate(old,t,commit,{allowReviewedControls:true}).safe,true);
 for(const mutate of [x=>x.Resources.Task.Properties.ContainerDefinitions[0].Environment[0].Value='other@example.invalid',x=>x.Resources.Task.UpdateReplacePolicy='Delete',x=>x.Resources.Task.Properties.ContainerDefinitions[0].Environment.push({Name:'UNREVIEWED',Value:'1'})]){
  const bad=structuredClone(t);mutate(bad);assert.throws(()=>validateRuntimeTemplate(old,bad,commit,{allowReviewedControls:true}));
 }
});

test('private storage activation requires exact account bucket region and no unrelated changes',()=>{
 const before=structuredClone(old);before.Resources.Task.Properties.ContainerDefinitions[0].Environment=[{Name:'TRACEPOINT_STORAGE_PROVIDER',Value:'supabase'}];
 const after=updated();after.Resources.Task.Properties.ContainerDefinitions[0].Environment=[{Name:'TRACEPOINT_STORAGE_PROVIDER',Value:'s3'},{Name:'AWS_REGION',Value:'us-east-1'},{Name:'TRACEPOINT_S3_BUCKET',Value:'tracepoint-staging-private-559054714699'},{Name:'TRACEPOINT_S3_EXPECTED_OWNER',Value:'559054714699'}];
 assert.throws(()=>validateRuntimeTemplate(before,after,commit));assert.equal(validateRuntimeTemplate(before,after,commit,{allowPrivateStorage:true}).safe,true);
 for(const mutate of [t=>t.Resources.Task.Properties.ContainerDefinitions[0].Environment[2].Value='other-bucket',t=>t.Resources.Task.Properties.ContainerDefinitions[0].Environment.push({Name:'AWS_REGION',Value:'us-west-2'}),t=>t.Resources.Task.Properties.ContainerDefinitions[0].Secrets=[],t=>t.Resources.Service.Properties.DesiredCount=2]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>validateRuntimeTemplate(before,bad,commit,{allowPrivateStorage:true}));}
});

test('CDK telemetry can vary across runners without admitting resource changes',()=>{
 const before=structuredClone(old);before.Resources.CDKMetadata={Type:'AWS::CDK::Metadata',Properties:{Analytics:'node24.15'},Condition:'TelemetryEnabled'};
 const after=updated();after.Resources.CDKMetadata=structuredClone(before.Resources.CDKMetadata);after.Resources.CDKMetadata.Properties.Analytics='node24.19';
 assert.equal(validateRuntimeTemplate(before,after,commit).safe,true);
 for(const mutate of [t=>t.Resources.CDKMetadata.Condition='Changed',t=>t.Resources.CDKMetadata.Properties.Other='changed',t=>t.Resources.CDKMetadata.Type='AWS::IAM::Role',t=>delete t.Resources.CDKMetadata]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>validateRuntimeTemplate(before,bad,commit));}
});
