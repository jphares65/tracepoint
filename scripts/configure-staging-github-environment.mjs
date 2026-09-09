import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const repository='jphares65/tracepoint',environment='aws-staging',branch='codex/aws-staging-readiness-20260902';
async function main(){
 assert.equal(process.argv[2],'--execute');assert.equal(process.argv.length,3);
 const identity=JSON.parse(execFileSync('aws.exe',['sts','get-caller-identity','--region','us-east-1','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));assert.equal(identity.Account,'559054714699');assert.match(identity.Arn,/^arn:aws:sts::559054714699:assumed-role\/[^/]*TracePointMigrationStaging[^/]*\//);
 const raw=execFileSync('git.exe',['-c','safe.directory='+process.cwd(),'credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
 const token=raw.split('\n').find(line=>line.startsWith('password='))?.slice(9);assert.ok(token);
 const api=async(endpoint,method='GET',body)=>{const r=await fetch('https://api.github.com/repos/'+repository+endpoint,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,json:r.status===204?{}:await r.json()};};
 let current=await api('/environments/'+environment);
 if(current.status===404)current=await api('/environments/'+environment,'PUT',{deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}});
 assert.equal(current.status,200,'GitHub environment setup unavailable');assert.equal(current.json.deployment_branch_policy?.custom_branch_policies,true);assert.equal(current.json.deployment_branch_policy?.protected_branches,false);
 let policies=await api('/environments/'+environment+'/deployment-branch-policies');assert.equal(policies.status,200);
 if(policies.json.branch_policies.length===0){const added=await api('/environments/'+environment+'/deployment-branch-policies','POST',{name:branch,type:'branch'});assert.equal(added.status,200);policies=await api('/environments/'+environment+'/deployment-branch-policies');}
 assert.equal(policies.json.branch_policies.length,1,'Unrelated environment branch rules cannot be overwritten');assert.equal(policies.json.branch_policies[0].name,branch);assert.equal(policies.json.branch_policies[0].type,'branch');
 const variables={AWS_STAGING_DEPLOY_ROLE_ARN:'arn:aws:iam::559054714699:role/TracePointMigrationStagingGitHub',STAGING_CERTIFICATE_ARN:'arn:aws:acm:us-east-1:559054714699:certificate/90d7c1b4-3d71-4168-a908-8678501f5e5a'};
 for(const [name,value]of Object.entries(variables)){const found=await api('/environments/'+environment+'/variables/'+name);if(found.status===200)assert.equal(found.json.value,value,'Existing environment variable differs; preserved');else{assert.equal(found.status,404);const added=await api('/environments/'+environment+'/variables','POST',{name,value});assert.equal(added.status,201);}}
 console.log(JSON.stringify({repository,environment,allowedBranch:branch,branchRestricted:true,variablesInstalled:Object.keys(variables),longLivedAwsKeysInstalled:false}));
}
main().catch(error=>{console.error(JSON.stringify({githubEnvironment:'FAILED',errorName:error.name,details:'Credentials and API response suppressed; unrelated settings preserved'}));process.exitCode=1;});
