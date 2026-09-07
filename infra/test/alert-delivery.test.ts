import * as cdk from 'aws-cdk-lib';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {AlertDeliveryStack} from '../lib/alert-delivery-stack';
test('staging alert fanout is encrypted, retained, scoped and contains no human recipient',()=>{
 const stack=new AlertDeliveryStack(new cdk.App(),'alerts',{environment:'staging',expectedAccount:'559054714699',env:{account:'559054714699',region:'us-east-1'}});const t=Template.fromStack(stack);
 assert.match(JSON.stringify(t.findResources('AWS::CloudWatch::CompositeAlarm')),/request-flood/);
 t.resourceCountIs('AWS::CloudWatch::Alarm',0);t.resourceCountIs('AWS::CloudWatch::CompositeAlarm',1);
 t.hasResourceProperties('AWS::CloudWatch::CompositeAlarm',{AlarmName:'tracepoint-staging-runtime-alert',AlarmActions:Match.anyValue(),OKActions:Match.anyValue()});
 t.hasResourceProperties('AWS::SNS::Topic',{KmsMasterKeyId:Match.anyValue()});t.hasResourceProperties('AWS::SNS::Subscription',{Protocol:'sqs',RawMessageDelivery:false});t.resourceCountIs('AWS::SNS::Subscription',1);
 t.hasResourceProperties('AWS::KMS::Key',{EnableKeyRotation:true,KeyPolicy:{Statement:Match.arrayWith([Match.objectLike({Principal:{Service:'cloudwatch.amazonaws.com'},Condition:{StringEquals:{'aws:SourceAccount':'559054714699'},ArnEquals:{'aws:SourceArn':Match.anyValue()}}})])}});
 t.resourceCountIs('AWS::SQS::Queue',2);t.hasResource('AWS::SQS::Queue',{DeletionPolicy:'Retain',Properties:Match.objectLike({SqsManagedSseEnabled:true,MessageRetentionPeriod:1209600})});
});
test('production alert fanout observes production-only CPU and latency alarms',()=>{
 const t=Template.fromStack(new AlertDeliveryStack(new cdk.App(),'prod',{environment:'production',expectedAccount:'222222222222',env:{account:'222222222222',region:'us-east-1'}}));
 t.hasResourceProperties('AWS::CloudWatch::CompositeAlarm',{AlarmName:'tracepoint-production-runtime-alert'});
 const serialized=JSON.stringify(t.findResources('AWS::CloudWatch::CompositeAlarm'));assert.match(serialized,/tracepoint-production-cpu/);assert.match(serialized,/tracepoint-production-latency-p99/);assert.doesNotMatch(serialized,/tracepoint-staging/);
});
test('alert stack denies management, environment mismatch and wrong region',()=>{
 for(const props of [{environment:'production' as const,expectedAccount:'265544358665',env:{account:'265544358665',region:'us-east-1'}},{environment:'production' as const,expectedAccount:'559054714699',env:{account:'559054714699',region:'us-east-1'}},{environment:'staging' as const,expectedAccount:'111111111111',env:{account:'111111111111',region:'us-east-1'}},{environment:'staging' as const,expectedAccount:'559054714699',env:{account:'559054714699',region:'us-west-2'}}])assert.throws(()=>new AlertDeliveryStack(new cdk.App(),'bad',props),/mismatch/);
});
