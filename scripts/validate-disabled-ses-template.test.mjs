import test from 'node:test';import assert from 'node:assert/strict';import {validateDisabledSes} from './validate-disabled-ses-template.mjs';
const template={Resources:{Identity:{Type:'AWS::SES::EmailIdentity',Properties:{EmailIdentity:'staging.tracepointhq.com',MailFromAttributes:{MailFromDomain:'bounce.staging.tracepointhq.com',BehaviorOnMxFailure:'REJECT_MESSAGE'}}}},Outputs:{ActivationGate:{Value:'DISABLED: prerequisites'}}};
test('disabled SES permits exact staging identity and denies runtime authority and production DNS',()=>{
 assert.equal(validateDisabledSes(template).safe,true);
 for(const mutate of [t=>t.Resources.Role={Type:'AWS::IAM::Policy'},t=>t.Resources.DNS={Type:'AWS::Route53::RecordSet'},t=>t.Resources.Identity.Properties.EmailIdentity='tracepointhq.com',t=>t.Resources.Identity.Properties.MailFromAttributes.BehaviorOnMxFailure='USE_DEFAULT_VALUE']){const bad=structuredClone(template);mutate(bad);assert.throws(()=>validateDisabledSes(bad));}
});
