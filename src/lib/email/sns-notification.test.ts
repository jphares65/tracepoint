import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { notificationSigningText, verifySnsNotification } from './sns-notification';
const topic='arn:aws:sns:us-east-1:559054714699:feedback';
let directory:string, privateKey:KeyObject, certificate:string;
before(()=>{
 // Synthetic ephemeral test material; never used as application credentials.
 directory=mkdtempSync(path.join(tmpdir(),'tracepoint-sns-test-'));
 privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
 const key=path.join(directory,'synthetic.key'), cert=path.join(directory,'synthetic.pem');
 writeFileSync(key,privateKey.export({format:'pem',type:'pkcs8'}));
 const windows=process.platform==='win32';
 execFileSync(windows?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl',
  ['req','-new','-x509','-key',key,'-out',cert,'-subj','/CN=synthetic.invalid','-days','1',
   ...(windows?['-config','C:/Program Files/Git/usr/ssl/openssl.cnf']:[])],{stdio:'ignore'});
 certificate=readFileSync(cert,'utf8');rmSync(key);
});
after(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});
function envelope(version='2') {
 const result:Record<string,unknown>={Message:'{"synthetic":true}',MessageId:'synthetic-id',Subject:'Synthetic\nsubject',Timestamp:new Date().toISOString(),TopicArn:topic,Type:'Notification',SignatureVersion:version,SigningCertURL:'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-synthetic.pem'};
 result.Signature=sign(version==='2'?'RSA-SHA256':'RSA-SHA1',Buffer.from(notificationSigningText(result)),privateKey).toString('base64');return result;
}
const certificateFetch=(async()=>new Response(certificate)) as typeof fetch;
test('valid SNS v1 and v2 signatures verify with exact canonical field ordering',async()=>{
 for(const version of ['1','2'])assert.equal((await verifySnsNotification(JSON.stringify(envelope(version)),topic,{fetch:certificateFetch})).notificationId,'synthetic-id');
});
test('tampered signed messages fail and certificate fetch rejects redirects',async()=>{
 const value=envelope();value.Message='tampered';await assert.rejects(verifySnsNotification(JSON.stringify(value),topic,{fetch:certificateFetch}),/validation failed/);
 let redirect:string|undefined;
 await verifySnsNotification(JSON.stringify(envelope()),topic,{fetch:(async(_url,init)=>{redirect=init?.redirect;return new Response(certificate);}) as typeof fetch});assert.equal(redirect,'error');
});
test('wrong tenant topic, management account, malformed and oversized input fail before network',async()=>{
 let calls=0;const noFetch=(async()=>{calls++;throw Error();}) as typeof fetch;
 for(const patch of [{TopicArn:topic+'-foreign'},{SigningCertURL:'https://sns.us-east-1.amazonaws.com.attacker.invalid/cert.pem'},
  {SigningCertURL:'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-x.pem?redirect=1'},
  {Type:'SubscriptionConfirmation'},{Timestamp:'invalid'},{SignatureVersion:'3'}])
  await assert.rejects(verifySnsNotification(JSON.stringify({...envelope(),...patch}),topic,{fetch:noFetch}),/validation failed/);
 for(const body of ['bad-json','x'.repeat(262145)])await assert.rejects(verifySnsNotification(body,topic,{fetch:noFetch}));
 await assert.rejects(verifySnsNotification(JSON.stringify(envelope()),topic.replace('559054714699','265544358665'),{fetch:noFetch}));assert.equal(calls,0);
});
test('certificate size limit and stale replay envelope fail closed',async()=>{
 await assert.rejects(verifySnsNotification(JSON.stringify(envelope()),topic,{fetch:(async()=>new Response('x'.repeat(16385))) as typeof fetch}));
 await assert.rejects(verifySnsNotification(JSON.stringify(envelope()),topic,{now:Date.now()+24*86400000,fetch:certificateFetch}));
});
