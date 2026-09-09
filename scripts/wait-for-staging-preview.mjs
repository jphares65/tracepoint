import assert from 'node:assert/strict';
try{
 const sha=process.env.GITHUB_SHA,token=process.env.GITHUB_TOKEN;assert.match(sha??'',/^[0-9a-f]{40}$/);assert.ok(token);assert.equal(process.env.GITHUB_REPOSITORY,'jphares65/tracepoint');assert.equal(process.env.GITHUB_REF,'refs/heads/codex/aws-staging-readiness-20260902');
 const deadline=Date.now()+15*60000;let ready=false;
 while(Date.now()<deadline){const response=await fetch('https://api.github.com/repos/jphares65/tracepoint/commits/'+sha+'/status',{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const result=await response.json();const status=result.statuses?.find(s=>s.context==='Vercel');if(status?.state==='success'){ready=true;break;}if(['failure','error'].includes(status?.state))throw Error();await new Promise(resolve=>setTimeout(resolve,15000));}
 assert.ok(ready);console.log(JSON.stringify({previewReady:true,commit:sha,productionModified:false}));
}catch{console.error('The staging branch Vercel Preview gate failed; AWS publication is blocked.');process.exitCode=1;}
