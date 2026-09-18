import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function validateOperationsRequest(request,context){
 assert.equal(context.branch,'refs/heads/main');
 assert.match(context.head,/^[0-9a-f]{40}$/);assert.equal(request.reviewedCommit,context.parent);assert.match(request.reviewedCommit,/^[0-9a-f]{40}$/);
 assert.deepEqual(context.changedFiles,['.github/staging-operations.json']);
 assert.deepEqual(Object.keys(request).sort(),['account','action','imageCommit','region','reviewedCommit'].sort());
 assert.equal(request.action,'collect-read-only-evidence');assert.equal(request.account,'559054714699');assert.equal(request.region,'us-east-1');
 assert.match(request.imageCommit,/^[0-9a-f]{40}$/);assert.equal(context.imageIsAncestor,true);
 return {accepted:true,action:request.action,imageCommit:request.imageCommit,reviewedCommit:request.reviewedCommit};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 assert.equal(process.env.GITHUB_EVENT_NAME,'push');
 const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const request=JSON.parse(readFileSync('.github/staging-operations.json','utf8')),head=git(['rev-parse','HEAD']);assert.equal(head,process.env.GITHUB_SHA);
 assert.match(request.imageCommit??'',/^[0-9a-f]{40}$/);git(['merge-base','--is-ancestor',request.imageCommit,head]);
 const result=validateOperationsRequest(request,{branch:process.env.GITHUB_REF,head,parent:git(['rev-parse','HEAD^']),changedFiles:git(['diff','--name-only','HEAD^',head]).split(/\r?\n/),imageIsAncestor:true});
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'imageCommit='+result.imageCommit+'\n');console.log(JSON.stringify(result));
}catch{console.error('Read-only staging operations request rejected.');process.exitCode=1;}}
