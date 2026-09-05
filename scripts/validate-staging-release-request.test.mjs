import assert from 'node:assert/strict';import {test} from 'node:test';import {validateReleaseRequest} from './validate-staging-release-request.mjs';
const request={reviewedCommit:'a'.repeat(40),environment:'staging',account:'559054714699',region:'us-east-1',action:'publish-and-deploy',reason:'Reviewed runtime fix'};
const context={branch:'refs/heads/codex/aws-staging-readiness-20260902',head:'b'.repeat(40),parent:'a'.repeat(40),changedFiles:['.github/staging-release.json']};
test('deliberate request binds a reviewed parent to an isolated staging image commit',()=>{assert.equal(validateReleaseRequest(request,context).accepted,true)});
test('production targets, unreviewed changes and main releases are rejected',()=>{
 for(const patch of [{account:'265544358665'},{account:'111111111111'},{environment:'production'},{region:'us-west-2'},{reviewedCommit:'c'.repeat(40)},{action:'cutover'}])assert.throws(()=>validateReleaseRequest({...request,...patch},context));
 for(const patch of [{branch:'refs/heads/main'},{changedFiles:['.github/staging-release.json','src/app/page.tsx']},{changedFiles:[]}])assert.throws(()=>validateReleaseRequest(request,{...context,...patch}));
});
