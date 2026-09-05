import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function validateReleaseRequest(request,context){
 assert.equal(context.branch,'refs/heads/codex/aws-staging-readiness-20260902');assert.match(context.head,/^[0-9a-f]{40}$/);assert.match(request.reviewedCommit,/^[0-9a-f]{40}$/);assert.equal(request.reviewedCommit,context.parent);
 assert.deepEqual(context.changedFiles,['.github/staging-release.json']);assert.equal(request.environment,'staging');assert.equal(request.account,'559054714699');assert.equal(request.region,'us-east-1');assert.ok(['publish-and-deploy','deploy-existing'].includes(request.action));
 if(request.action==='deploy-existing'){assert.match(request.imageCommit,/^[0-9a-f]{40}$/);assert.equal(context.imageIsAncestor,true);assert.equal(context.runtimeSourceMatches,true);}
 assert.equal(typeof request.reason,'string');assert.ok(request.reason.length>0&&request.reason.length<=240);assert.ok(!/[\r\n\x00-\x1f]/.test(request.reason));
 return {accepted:true,reviewedCommit:request.reviewedCommit,imageSourceCommit:request.action==='deploy-existing'?request.imageCommit:context.head,publish:request.action==='publish-and-deploy',account:request.account,region:request.region};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  assert.equal(process.env.GITHUB_EVENT_NAME,'push');
  const git=args=>execFileSync('git.exe',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const head=git(['rev-parse','HEAD']),parent=git(['rev-parse','HEAD^']);assert.equal(head,process.env.GITHUB_SHA);
  const request=JSON.parse(readFileSync('.github/staging-release.json','utf8'));
  let imageIsAncestor=false,runtimeSourceMatches=false;
  if(request.action==='deploy-existing'){
   assert.match(request.imageCommit,/^[0-9a-f]{40}$/);git(['merge-base','--is-ancestor',request.imageCommit,head]);imageIsAncestor=true;
   const paths=['.dockerignore','buildspec.staging-image.yml','Dockerfile','eslint.config.mjs','next.config.ts','package.json','package-lock.json','postcss.config.mjs','tsconfig.json','public','src','scripts/start-tracepoint-container.mjs','scripts/validate-tracepoint-runtime-config.mjs'];
   runtimeSourceMatches=git(['diff','--name-only',request.imageCommit,head,'--',...paths])==='';
  }
  const result=validateReleaseRequest(request,{branch:process.env.GITHUB_REF,head,parent,changedFiles:git(['diff','--name-only',parent,head]).split(/\r?\n/),imageIsAncestor,runtimeSourceMatches});
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'imageCommit='+result.imageSourceCommit+'\npublish='+result.publish+'\n');
  console.log(JSON.stringify(result));
 }catch{console.error('Staging release request failed its reviewed-source boundary.');process.exitCode=1;}
}
