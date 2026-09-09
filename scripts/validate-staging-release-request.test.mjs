import assert from 'node:assert/strict';import {test} from 'node:test';import {validateReleaseRequest} from './validate-staging-release-request.mjs';
const request={reviewedCommit:'a'.repeat(40),environment:'staging',account:'559054714699',region:'us-east-1',action:'publish-and-deploy',reason:'Reviewed runtime fix'};
const context={branch:'refs/heads/codex/aws-staging-readiness-20260902',head:'b'.repeat(40),parent:'a'.repeat(40),changedFiles:['.github/staging-release.json']};
test('deliberate request binds a reviewed parent to an isolated staging image commit',()=>{assert.equal(validateReleaseRequest(request,context).accepted,true)});
test('production targets, unreviewed changes and main releases are rejected',()=>{
 for(const patch of [{account:'265544358665'},{account:'111111111111'},{environment:'production'},{region:'us-west-2'},{reviewedCommit:'c'.repeat(40)},{action:'cutover'}])assert.throws(()=>validateReleaseRequest({...request,...patch},context));
 for(const patch of [{branch:'refs/heads/main'},{changedFiles:['.github/staging-release.json','src/app/page.tsx']},{changedFiles:[]}])assert.throws(()=>validateReleaseRequest(request,{...context,...patch}));
});

test('existing immutable image requires ancestor and identical runtime source',()=>{
 const request={reviewedCommit:'a'.repeat(40),environment:'staging',account:'559054714699',region:'us-east-1',action:'deploy-existing',imageCommit:'b'.repeat(40),reason:'Resume scan-clean release'};
 const context={branch:'refs/heads/codex/aws-staging-readiness-20260902',head:'c'.repeat(40),parent:request.reviewedCommit,changedFiles:['.github/staging-release.json'],imageIsAncestor:true,runtimeSourceMatches:true};
 assert.equal(validateReleaseRequest(request,context).publish,false);assert.equal(validateReleaseRequest(request,context).imageSourceCommit,request.imageCommit);
 for(const change of [{imageIsAncestor:false},{runtimeSourceMatches:false}])assert.throws(()=>validateReleaseRequest(request,{...context,...change}));
});

test('rollback request is confined to the exact staging task family',()=>{
 const request={reviewedCommit:'a'.repeat(40),environment:'staging',account:'559054714699',region:'us-east-1',action:'publish-and-deploy',reason:'Controlled rehearsal',rollbackPriorTaskArn:'arn:aws:ecs:us-east-1:559054714699:task-definition/tracepointstagingruntimeServiceTaskDefC2B9B4C5:16'};
 const context={branch:'refs/heads/codex/aws-staging-readiness-20260902',head:'c'.repeat(40),parent:request.reviewedCommit,changedFiles:['.github/staging-release.json']};assert.equal(validateReleaseRequest(request,context).rollbackPriorTaskArn,request.rollbackPriorTaskArn);
 for(const value of [request.rollbackPriorTaskArn.replace('559054714699','265544358665'),request.rollbackPriorTaskArn.replace('C2B9B4C5','other'),'bad'])assert.throws(()=>validateReleaseRequest({...request,rollbackPriorTaskArn:value},context));
});
