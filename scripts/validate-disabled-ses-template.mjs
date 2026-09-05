import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
export function validateDisabledSes(t){
 const permitted=new Set(['AWS::SES::ConfigurationSet','AWS::SES::EmailIdentity','AWS::SES::ConfigurationSetEventDestination','AWS::KMS::Key','AWS::SNS::Topic','AWS::SNS::TopicPolicy','AWS::SNS::Subscription','AWS::SQS::Queue','AWS::SQS::QueuePolicy','AWS::CDK::Metadata']);
 for(const r of Object.values(t.Resources))assert.ok(permitted.has(r.Type),'Unexpected disabled SES resource');
 const identities=Object.values(t.Resources).filter(r=>r.Type==='AWS::SES::EmailIdentity');assert.equal(identities.length,1);assert.equal(identities[0].Properties.EmailIdentity,'staging.tracepointhq.com');assert.equal(identities[0].Properties.MailFromAttributes.MailFromDomain,'bounce.staging.tracepointhq.com');assert.equal(identities[0].Properties.MailFromAttributes.BehaviorOnMxFailure,'REJECT_MESSAGE');
 assert.match(t.Outputs.ActivationGate.Value,/^DISABLED:/);
 return {safe:true,providerActivation:'disabled',runtimePermission:'none',dnsMutation:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(validateDisabledSes(JSON.parse((await readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,'')))));
