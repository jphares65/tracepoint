import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateOperationsRequest} from './validate-staging-operations-request.mjs';
const request={action:'collect-read-only-evidence',account:'559054714699',region:'us-east-1',reviewedCommit:'a'.repeat(40),imageCommit:'b'.repeat(40)};
const context={branch:'refs/heads/codex/aws-staging-readiness-20260902',head:'c'.repeat(40),parent:'a'.repeat(40),changedFiles:['.github/staging-operations.json'],imageIsAncestor:true};
test('operations request binds a reviewed parent and existing image without deployment authority',()=>{
 assert.equal(validateOperationsRequest(request,context).action,'collect-read-only-evidence');
});
test('production, management, arbitrary commands and mixed-source pushes are rejected',()=>{
 for(const patch of [{account:'265544358665'},{account:'111111111111'},{region:'us-west-2'},{action:'deploy-existing'},{reviewedCommit:'b'.repeat(40)},{imageCommit:'HEAD; command'},{command:'deploy'}])assert.throws(()=>validateOperationsRequest({...request,...patch},context));
 for(const patch of [{branch:'refs/heads/main'},{imageIsAncestor:false},{changedFiles:['.github/staging-operations.json','src/app/page.tsx']}])assert.throws(()=>validateOperationsRequest(request,{...context,...patch}));
});
