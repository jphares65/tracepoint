import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import {Construct} from 'constructs';

export class AlertDeliveryStack extends cdk.Stack {
 constructor(scope:Construct,id:string,props:cdk.StackProps){
  super(scope,id,props);
  if(this.account!=='559054714699'||this.region!=='us-east-1')throw Error('Staging alert delivery account/region mismatch');
  const alarmName='tracepoint-staging-runtime-alert';
  const alarmArn=this.formatArn({service:'cloudwatch',resource:'alarm',resourceName:alarmName,arnFormat:cdk.ArnFormat.COLON_RESOURCE_NAME});
  const key=new kms.Key(this,'AlertKey',{enableKeyRotation:true,removalPolicy:cdk.RemovalPolicy.RETAIN});
  key.addToResourcePolicy(new iam.PolicyStatement({principals:[new iam.ServicePrincipal('cloudwatch.amazonaws.com')],actions:['kms:Decrypt','kms:GenerateDataKey*'],resources:['*'],conditions:{StringEquals:{'aws:SourceAccount':this.account},ArnEquals:{'aws:SourceArn':alarmArn}}}));
  const topic=new sns.Topic(this,'Alerts',{topicName:'tracepoint-staging-runtime-alerts',masterKey:key});topic.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  topic.addToResourcePolicy(new iam.PolicyStatement({principals:[new iam.ServicePrincipal('cloudwatch.amazonaws.com')],actions:['sns:Publish'],resources:[topic.topicArn],conditions:{StringEquals:{'aws:SourceAccount':this.account},ArnEquals:{'aws:SourceArn':alarmArn}}}));
  const failures=new sqs.Queue(this,'DeliveryFailures',{queueName:'tracepoint-staging-alert-delivery-failures',encryption:sqs.QueueEncryption.SQS_MANAGED,enforceSSL:true,retentionPeriod:cdk.Duration.days(14),removalPolicy:cdk.RemovalPolicy.RETAIN});
  const receipts=new sqs.Queue(this,'Receipts',{queueName:'tracepoint-staging-alert-receipts',encryption:sqs.QueueEncryption.SQS_MANAGED,enforceSSL:true,retentionPeriod:cdk.Duration.days(14),visibilityTimeout:cdk.Duration.seconds(60),deadLetterQueue:{queue:failures,maxReceiveCount:5},removalPolicy:cdk.RemovalPolicy.RETAIN});
  topic.addSubscription(new subscriptions.SqsSubscription(receipts,{rawMessageDelivery:false,deadLetterQueue:failures}));
  const names=['application-5xx','memory','alb-5xx-rate','unhealthy-target','request-flood'];
  const alarm=new cloudwatch.CompositeAlarm(this,'RuntimeAlert',{compositeAlarmName:alarmName,alarmDescription:'TracePoint staging runtime incident; human subscription confirmation remains a cutover gate.',alarmRule:cloudwatch.AlarmRule.anyOf(...names.map((name,index)=>cloudwatch.AlarmRule.fromAlarm(cloudwatch.Alarm.fromAlarmName(this,'Observed'+index,'tracepoint-staging-'+name),cloudwatch.AlarmState.ALARM)))});
  alarm.addAlarmAction(new actions.SnsAction(topic));alarm.addOkAction(new actions.SnsAction(topic));
  new cdk.CfnOutput(this,'AlertTopicArn',{value:topic.topicArn});
  new cdk.CfnOutput(this,'ReceiptQueueUrl',{value:receipts.queueUrl});
  new cdk.CfnOutput(this,'CompositeAlarmName',{value:alarmName});
 }
}
