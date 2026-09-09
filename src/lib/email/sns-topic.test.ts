import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseSnsTopic} from './sns-topic';
import {verifySnsNotification} from './sns-notification';
import {createSesFeedbackBatchHandler} from './ses-feedback-batch';
const account='559054714699';
test('commercial and GovCloud topic regions retain their exact partition',()=>{
 for(const [partition,region] of [['aws','us-east-1'],['aws','eu-central-1'],['aws-us-gov','us-gov-east-1'],['aws-us-gov','us-gov-west-1']]){
  assert.deepEqual(parseSnsTopic(`arn:${partition}:sns:${region}:${account}:feedback`),{partition,region,account});
 }
});
test('inconsistent partitions fail construction and verification before network access',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw Error('Network disabled');};
 for(const [partition,region] of [['aws-us-gov','us-east-1'],['aws','us-gov-west-1'],['aws','cn-north-1'],['aws-cn','cn-north-1'],['aws-us-gov','us-gov-north-1'],['aws','invalid']]){
  const topicArn=`arn:${partition}:sns:${region}:${account}:feedback`;
  assert.throws(()=>parseSnsTopic(topicArn));
  assert.throws(()=>createSesFeedbackBatchHandler({account,topicArn,store:{async apply(){return 'applied';}}}));
  await assert.rejects(verifySnsNotification('{}',topicArn,{fetch:fetcher}));
 }
 assert.equal(calls,0);
});
test('management account and malformed resource names are rejected',()=>{
 for(const arn of ['arn:aws:sns:us-east-1:265544358665:feedback',`arn:aws:sns:us-east-1:${account}:feedback/foreign`,`arn:aws:sns:us-east-1:${account}:feedback?redirect=1`])assert.throws(()=>parseSnsTopic(arn));
});
