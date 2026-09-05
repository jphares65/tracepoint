import * as cdk from 'aws-cdk-lib';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {AlertDeliveryStack} from '../lib/alert-delivery-stack';
test('staging alert fanout is encrypted, retained, scoped and contains no human recipient',()=>{
 const stack=new AlertDeliveryStack(new cdk.App(),'alerts',{env:{account:'559054714699',region:'us-east-1'}});const t=Template.fromStack(stack);
 t.resourceCountIs('AWS::CloudWatch::Alarm',0);t.resourceCountIs('AWS::CloudWatch::CompositeAlarm',1);
 t.hasResourceProperties('AWS::CloudWatch::CompositeAlarm',{AlarmName:'tracepoint-staging-runtime-alert',AlarmActions:Match.anyValue(),OKActions:Match.anyValue()});
 t.hasResourceProperties('AWS::SNS::Topic',{KmsMasterKeyId:Match.anyValue()});t.hasResourceProperties('AWS::SNS::Subscription',{Protocol:'sqs',RawMessageDelivery:false});t.resourceCountIs('AWS::SNS::Subscription',1);
 t.hasResourceProperties('AWS::KMS::Key',{EnableKeyRotation:true,KeyPolicy:{Statement:Match.arrayWith([Match.objectLike({Principal:{Service:'cloudwatch.amazonaws.com'},Condition:{StringEquals:{'aws:SourceAccount':'559054714699'},ArnEquals:{'aws:SourceArn':Match.anyValue()}}})])}});
 t.resourceCountIs('AWS::SQS::Queue',2);t.hasResource('AWS::SQS::Queue',{DeletionPolicy:'Retain',Properties:Match.objectLike({SqsManagedSseEnabled:true,MessageRetentionPeriod:1209600})});
});
test('alert stack denies production, management and wrong region',()=>{
 for(const [account,region] of [['265544358665','us-east-1'],['111111111111','us-east-1'],['559054714699','us-west-2']])assert.throws(()=>new AlertDeliveryStack(new cdk.App(),'bad',{env:{account,region}}),/mismatch/);
});
