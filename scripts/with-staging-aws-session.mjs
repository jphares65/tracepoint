import {execFileSync,spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const [command,...args]=process.argv.slice(2);assert.ok(command,'Supply a command and arguments');
const sourceEnv={...process.env,AWS_PROFILE:'tracepoint-member-staging',AWS_REGION:'us-east-1',AWS_DEFAULT_REGION:'us-east-1'};
for(const key of ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'])delete sourceEnv[key];
function aws(arguments_,env){try{return JSON.parse(execFileSync('aws.exe',arguments_,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch{throw Error('Staging credential operation failed; details suppressed');}}
function verify(id){assert.equal(id.Account,'559054714699');assert.match(id.Arn,new RegExp('^arn:aws:sts::559054714699:assumed-role/[^/]*TracePointMigrationStaging[^/]*/'));}
verify(aws(['sts','get-caller-identity','--output','json'],sourceEnv));
const temporary=aws(['configure','export-credentials','--format','process'],sourceEnv);
assert.ok(Date.parse(temporary.Expiration)>Date.now()+300000,'Temporary staging session expires too soon');
const env={...sourceEnv,AWS_ACCESS_KEY_ID:temporary.AccessKeyId,AWS_SECRET_ACCESS_KEY:temporary.SecretAccessKey,AWS_SESSION_TOKEN:temporary.SessionToken};delete env.AWS_PROFILE;
verify(aws(['sts','get-caller-identity','--output','json'],env));
// Only the child process receives temporary credentials; nothing is persisted.
const child=spawn(command,args,{env,stdio:'inherit',shell:false});
child.on('error',()=>{console.error('Staging child process could not start');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
