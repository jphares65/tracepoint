import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSesFeedbackBatchHandler} from './ses-feedback-batch';
const account='559054714699',topicArn=`arn:aws:sns:us-east-1:${account}:feedback`;
const body=JSON.stringify({eventType:'Delivery',mail:{sendingAccountId:account,messageId:'accepted-1'},delivery:{recipients:['synthetic@example.invalid']}});
const verify=async(message:string,topic:string)=>({notificationId:'sns-1',topicArn:topic,message});
test('committed and duplicate feedback acknowledge; persistence failure retries only failed record',async()=>{
 let calls=0;const handler=createSesFeedbackBatchHandler({account,topicArn,verify,store:{apply:async()=>{calls++;if(calls===2)throw Error('Uncorrelated acceptance');return calls===1?'applied':'duplicate';}}});
 const result=await handler({Records:['first','retry','duplicate'].map(messageId=>({messageId,body}))});assert.deepEqual(result,{batchItemFailures:[{itemIdentifier:'retry'}]});assert.equal(calls,3);
});
test('malformed, wrong-account, oversized and unsigned feedback never reaches persistence',async()=>{
 let calls=0;const store={apply:async()=>{calls++;return 'applied' as const;}};
 const handler=createSesFeedbackBatchHandler({account,topicArn,verify,store});
 const result=await handler({Records:[{messageId:'malformed',body:'{'},{messageId:'foreign',body:body.replace(account,'111111111111')},{messageId:'oversized',body:'x'.repeat(262145)}]});assert.equal(result.batchItemFailures.length,3);
 const signed=createSesFeedbackBatchHandler({account,topicArn,store});assert.deepEqual(await signed({Records:[{messageId:'unsigned',body}]}),{batchItemFailures:[{itemIdentifier:'unsigned'}]});assert.equal(calls,0);
});
test('account mismatch and duplicate queue identifiers fail closed',async()=>{
 const store={apply:async()=> 'applied' as const};assert.throws(()=>createSesFeedbackBatchHandler({account:'265544358665',topicArn,store}));assert.throws(()=>createSesFeedbackBatchHandler({account:'111111111111',topicArn,store}));
 const handler=createSesFeedbackBatchHandler({account,topicArn,store,verify});await assert.rejects(handler({Records:[{messageId:'same',body},{messageId:'same',body}]}));
});
