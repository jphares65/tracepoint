import {verifySnsNotification, type VerifiedNotification} from './sns-notification';
import {parseSesFeedback, type SesFeedbackStore} from './ses-feedback';

type QueueRecord = {messageId:string;body:string};
type Dependencies = {
 account:string;topicArn:string;store:Pick<SesFeedbackStore,'apply'>;
 verify?: (body:string,topicArn:string)=>Promise<VerifiedNotification>;
};

// Lambda SQS partial-batch contract. Successful records are acknowledged only
// after the durable transaction commits. This consumer never sends email.
export function createSesFeedbackBatchHandler({account,topicArn,store,verify=verifySnsNotification}:Dependencies) {
 if(!/^\d{12}$/.test(account)||account==='265544358665'||
   !new RegExp(`^arn:(aws|aws-us-gov):sns:[a-z0-9-]+:${account}:[A-Za-z0-9_-]+$`).test(topicArn))throw new Error('SES feedback account/topic boundary failed.');
 return async ({Records}: {Records:QueueRecord[]}) => {
  if(!Array.isArray(Records)||Records.length>10||Records.some(x=>!x||typeof x.messageId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(x.messageId))||new Set(Records.map(x=>x.messageId)).size!==Records.length)throw new Error('Invalid feedback batch metadata.');
  const batchItemFailures:Array<{itemIdentifier:string}>=[];
  for(const record of Records) {
   try {
    if(typeof record.body!=='string'||Buffer.byteLength(record.body)>262144)throw new Error();
    const notification=await verify(record.body,topicArn);
    if(notification.topicArn!==topicArn)throw new Error();
    await store.apply(parseSesFeedback(notification,account));
   } catch {batchItemFailures.push({itemIdentifier:record.messageId});}
  }
  return {batchItemFailures};
 };
}
