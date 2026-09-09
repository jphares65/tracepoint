import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deliverOutboxMessage} from './outbox-delivery';
import {EmailDeliveryUnconfirmedError,EmailProviderResponseError,type EmailProvider} from './provider-core';
const message={to:[{email:'synthetic@example.invalid'}],subject:'Synthetic',htmlContent:'Synthetic',textContent:'Synthetic'};
test('accepted send with failed persistence is never scheduled for resend and retains acceptance ID',async()=>{
 let sends=0;const provider:EmailProvider={name:'Brevo',async send(){sends++;return {messageId:'synthetic-accepted'}}};
 const result=await deliverOutboxMessage(provider,message,async()=>{throw Error('private database detail')});assert.equal(result.kind,'reconcile');assert.equal(result.messageId,'synthetic-accepted');assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(sends,1);
});
test('only explicit throttling rejection permits retry; ambiguous and terminal outcomes do not',async()=>{
 for(const [error,expected] of [[new EmailProviderResponseError(429,'private'),'retry'],[new EmailProviderResponseError(400,'private'),'failed'],[new EmailProviderResponseError(409,'private'),'failed'],[new EmailDeliveryUnconfirmedError(),'reconcile'],[new EmailProviderResponseError(502,'private'),'reconcile'],[new Error('private transport'),'reconcile']] as const){
 let sends=0,records=0;const result=await deliverOutboxMessage({name:'SES',async send(){sends++;throw error}},message,async()=>{records++});assert.equal(result.kind,expected);assert.equal(sends,1);assert.equal(records,0);assert.equal(JSON.stringify(result).includes('private'),false);
 }
});
test('confirmed delivery records acceptance exactly once',async()=>{
 let records=0;const result=await deliverOutboxMessage({name:'Brevo',async send(){return {messageId:'accepted'}}},message,async id=>{assert.equal(id,'accepted');records++});assert.deepEqual(result,{kind:'sent',messageId:'accepted'});assert.equal(records,1);
});
test('missing acceptance identifier is held for reconciliation before recording success',async()=>{
 let recorded=false;const result=await deliverOutboxMessage({name:'Brevo',async send(){return {messageId:null}}},message,async()=>{recorded=true});assert.equal(result.kind,'reconcile');assert.equal(recorded,false);
});
