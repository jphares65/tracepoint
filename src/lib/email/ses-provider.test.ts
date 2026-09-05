import assert from 'node:assert/strict';
import test from 'node:test';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesEmailProvider } from './ses-provider-core';
import { createEmailProvider } from './provider-core';
const message = {to:[{email:'Recipient@example.invalid',name:'Synthetic Recipient'}],subject:'Qualification',htmlContent:'<p>Passed</p>',textContent:'Passed'};
function setup(suppression: (email:string)=>Promise<boolean> = async()=>false) {
 const sent: SendEmailCommand[]=[];
 const provider=new SesEmailProvider({fromEmail:'sender@example.invalid',configurationSet:'tracepoint-staging',isSuppressed:suppression,transport:{async send(command){sent.push(command);return {MessageId:'synthetic-id'};}}});
 return {provider,sent};
}
test('prepared SES adapter preserves content and requires event configuration',async()=>{
 const checked:string[]=[];const {provider,sent}=setup(async email=>{checked.push(email);return false;});
 assert.deepEqual(await provider.send(message),{messageId:'synthetic-id'});
 assert.deepEqual(checked,['recipient@example.invalid']);assert.equal(sent.length,1);
 assert.equal(sent[0].input.ConfigurationSetName,'tracepoint-staging');
 assert.equal(sent[0].input.Content?.Simple?.Body?.Text?.Data,'Passed');
 assert.equal(sent[0].input.Content?.Simple?.Body?.Html?.Data,'<p>Passed</p>');
 assert.match(sent[0].input.Destination?.ToAddresses?.[0]??'',/Recipient@example.invalid/);
});
test('suppressed recipient or suppression outage prevents all provider I/O',async()=>{
 for(const lookup of [async()=>true,async()=>{throw new Error('private diagnostic');}]){
  const {provider,sent}=setup(lookup);await assert.rejects(provider.send(message),/Delivery blocked/);assert.equal(sent.length,0);
 }
});
test('malformed headers and recipient counts fail before provider I/O',async()=>{
 for(const invalid of [{...message,to:[]},{...message,subject:'Subject\r\nBcc: attacker@example.invalid'},{...message,to:[{email:'a@example.invalid\nb@example.invalid'}]},{...message,to:[{email:'a@example.invalid',name:'Bad\nName'}]}]){
  const {provider,sent}=setup();await assert.rejects(provider.send(invalid));assert.equal(sent.length,0);
 }
});
test('ambiguous SES failure is sanitized and never retried',async()=>{
 let attempts=0;
 const provider=new SesEmailProvider({fromEmail:'sender@example.invalid',configurationSet:'tracepoint-staging',isSuppressed:async()=>false,transport:{async send(){attempts++;throw new Error('private-content');}}});
 await assert.rejects(provider.send(message),error=>error instanceof Error&&error.message.includes('unconfirmed')&&!error.message.includes('private-content'));
 assert.equal(attempts,1);
});
test('SES remains unavailable from the live provider selector',()=>{
 assert.throws(()=>createEmailProvider({TRACEPOINT_EMAIL_PROVIDER:'ses'}),/not implemented/);
});
