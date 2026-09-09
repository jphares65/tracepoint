import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
export interface SesFoundationProps extends cdk.StackProps { environmentName:'staging'|'production'; mailFromSubdomain:string; taskRole?:iam.IRole; }
export class SesFoundationStack extends cdk.Stack {
 constructor(scope:Construct,id:string,props:SesFoundationProps){
  super(scope,id,props);
  if(this.region!=='us-east-1'||this.account==='265544358665'||(props.environmentName==='staging'?this.account!=='559054714699':this.account==='559054714699'))throw Error('SES account/environment boundary');
  if(!/^[a-z][a-z0-9-]{0,30}$/.test(props.mailFromSubdomain))throw Error('Explicit MAIL FROM subdomain required');
  const domain=props.environmentName==='staging'?'staging.tracepointhq.com':'tracepointhq.com';
  const from='notifications@'+domain,mailFrom=props.mailFromSubdomain+'.'+domain;
  const configuration=new ses.ConfigurationSet(this,'DeliveryConfiguration',{
   configurationSetName:'tracepoint-'+props.environmentName,reputationMetrics:true,
   suppressionReasons:ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,tlsPolicy:ses.ConfigurationSetTlsPolicy.REQUIRE,
  });
  const identity=new ses.EmailIdentity(this,'SenderDomain',{
   identity:ses.Identity.domain(domain),configurationSet:configuration,dkimSigning:true,
   dkimIdentity:ses.DkimIdentity.easyDkim(ses.EasyDkimSigningKeyLength.RSA_2048_BIT),
   mailFromDomain:mailFrom,mailFromBehaviorOnMxFailure:ses.MailFromBehaviorOnMxFailure.REJECT_MESSAGE,feedbackForwarding:true,
  });identity.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  const key=new kms.Key(this,'FeedbackKey',{enableKeyRotation:true,removalPolicy:cdk.RemovalPolicy.RETAIN});
  const configArn=this.formatArn({service:'ses',resource:'configuration-set',resourceName:configuration.configurationSetName});
  key.addToResourcePolicy(new iam.PolicyStatement({principals:[new iam.ServicePrincipal('ses.amazonaws.com')],actions:['kms:GenerateDataKey*','kms:Decrypt'],resources:['*'],conditions:{StringEquals:{'aws:SourceAccount':this.account,'aws:SourceArn':configArn}}}));
  const topic=new sns.Topic(this,'Feedback',{topicName:'tracepoint-'+props.environmentName+'-ses-feedback',masterKey:key});topic.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  const deadLetterQueue=new sqs.Queue(this,'FeedbackDeadLetters',{encryption:sqs.QueueEncryption.SQS_MANAGED,enforceSSL:true,retentionPeriod:cdk.Duration.days(14),removalPolicy:cdk.RemovalPolicy.RETAIN});
  const queue=new sqs.Queue(this,'FeedbackQueue',{encryption:sqs.QueueEncryption.SQS_MANAGED,enforceSSL:true,retentionPeriod:cdk.Duration.days(14),visibilityTimeout:cdk.Duration.minutes(3),deadLetterQueue:{queue:deadLetterQueue,maxReceiveCount:5},removalPolicy:cdk.RemovalPolicy.RETAIN});
  // Preserve the signed SNS envelope; the consumer verifies it before persistence.
  topic.addSubscription(new subscriptions.SqsSubscription(queue,{rawMessageDelivery:false,deadLetterQueue}));
  configuration.addEventDestination('FeedbackEvents',{destination:ses.EventDestination.snsTopic(topic),events:[ses.EmailSendingEvent.BOUNCE,ses.EmailSendingEvent.COMPLAINT,ses.EmailSendingEvent.DELIVERY]});
  if(props.taskRole)new iam.Policy(this,'PreparedRuntimeSendPolicy',{roles:[props.taskRole],statements:[new iam.PolicyStatement({actions:['ses:SendEmail'],resources:[identity.emailIdentityArn],conditions:{StringEquals:{'ses:FromAddress':from}}})]});
  const records=[...identity.dkimRecords.map(x=>({type:'CNAME',name:x.name,value:x.value})),
   {type:'MX',name:mailFrom,value:'10 feedback-smtp.us-east-1.amazonses.com'},
   {type:'TXT',name:mailFrom,value:'v=spf1 include:amazonses.com -all'},
   {type:'TXT',name:'_dmarc.'+domain,value:'v=DMARC1; p=none;'}];
  new cdk.CfnOutput(this,'DnsRecords',{value:cdk.Fn.toJsonString(records)});
  new cdk.CfnOutput(this,'ConfigurationSet',{value:configuration.configurationSetName});new cdk.CfnOutput(this,'FromAddress',{value:from});new cdk.CfnOutput(this,'FeedbackTopicArn',{value:topic.topicArn});
  new cdk.CfnOutput(this,'FeedbackQueueArn',{value:queue.queueArn});
  new cdk.CfnOutput(this,'ActivationGate',{value:'DISABLED: durable queue and batch consumer prepared; require explicit runtime send permission and worker deployment with trusted database connection, DNS verification, sandbox readiness, suppression import and real delivery before activation.'});
 }
}
