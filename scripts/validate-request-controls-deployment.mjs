import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const allowed=new Set(['AWS::KMS::Key','AWS::Logs::LogGroup','AWS::Logs::ResourcePolicy','AWS::WAFv2::WebACL','AWS::WAFv2::LoggingConfiguration','AWS::WAFv2::WebACLAssociation','AWS::CloudWatch::Alarm','AWS::CDK::Metadata']);
export function validateRequestControlsDeployment(next,prior=null){
 const resources=Object.values(next.Resources);assert.ok(resources.length<=10&&resources.every(r=>allowed.has(r.Type)));
 const acl=resources.filter(r=>r.Type==='AWS::WAFv2::WebACL');assert.equal(acl.length,1);assert.equal(acl[0].Properties.Name,'tracepoint-staging-requests');assert.equal(acl[0].Properties.Scope,'REGIONAL');assert.deepEqual(acl[0].Properties.DefaultAction,{Allow:{}});assert.equal(acl[0].Properties.VisibilityConfig.SampledRequestsEnabled,false);
 const association=resources.find(r=>r.Type==='AWS::WAFv2::WebACLAssociation');assert.equal(association?.Properties.ResourceArn,'arn:aws:elasticloadbalancing:us-east-1:559054714699:loadbalancer/app/tracep-Servi-G9c0RkjQMCj4/af079dabc04bbb9c');
 if(prior){assert.deepEqual(Object.keys(next.Resources).sort(),Object.keys(prior.Resources).sort());for(const [name,value]of Object.entries(next.Resources)){if(value.Type==='AWS::CDK::Metadata')continue;const before=structuredClone(prior.Resources[name]);const after=structuredClone(value);if(value.Type==='AWS::WAFv2::WebACL'){delete before.Properties.Rules;delete after.Properties.Rules;}assert.deepEqual(after,before,'Only WAF rule mode changes are permitted');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const decode=async p=>{const b=await readFile(p);return JSON.parse(b.toString(b[0]===255?'utf16le':'utf8').replace(/^\uFEFF/,''));};try{const prior=process.argv[3]?await decode(process.argv[3]):null;const body=prior?.TemplateBody??prior;validateRequestControlsDeployment(await decode(process.argv[2]),typeof body==='string'?JSON.parse(body):body);console.log('Request-control structural gate passed.');}catch{console.error('Request-control structural gate failed; no deployment authorized.');process.exitCode=1;}}
