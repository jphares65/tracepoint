import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesAlarmReceipt} from './test-staging-alarm-delivery.mjs';
function receipt(overrides={},topic='arn:aws:sns:us-east-1:559054714699:tracepoint-staging-runtime-alerts'){
 return JSON.stringify({TopicArn:topic,Message:JSON.stringify({AlarmName:'tracepoint-staging-runtime-alert',AWSAccountId:'559054714699',NewStateValue:'ALARM',NewStateReason:'TracePoint disposable alarm delivery synthetic ALARM',...overrides})});
}
test('only exact rehearsal alarm receipts are acknowledged',()=>{
 assert.equal(matchesAlarmReceipt(receipt(),'synthetic','ALARM'),true);
 for(const data of [receipt({AWSAccountId:'265544358665'}),receipt({NewStateReason:'Actual incident'}),receipt({AlarmName:'other'}),receipt({},'arn:aws:sns:us-east-1:111111111111:foreign'),'{'])assert.equal(matchesAlarmReceipt(data,'synthetic','ALARM'),false);
 assert.equal(matchesAlarmReceipt(receipt(),'another-run','ALARM'),false);assert.equal(matchesAlarmReceipt(receipt(),'synthetic','OK'),false);
});
