import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {CognitoFoundationStack} from '../lib/cognito-foundation-stack';
import {SesFoundationStack} from '../lib/ses-foundation-stack';
import {SesFeedbackWorkerStack} from '../lib/ses-feedback-worker-stack';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
for(const environmentName of ['staging','production'] as const){
 test(environmentName+' Cognito uses short sessions, rotation, TOTP and exact callback domain',()=>{
  const account=environmentName==='staging'?'559054714699':'111111111111';const app=new cdk.App();
  const stack=new CognitoFoundationStack(app,'auth',{env:{account,region:'us-east-1'},environmentName,sesFromAddress:`notifications@${environmentName==='staging'?'staging.tracepointhq.com':'tracepointhq.com'}`,sesConfigurationSetName:`tracepoint-${environmentName}`});const template=Template.fromStack(stack);
  template.hasResourceProperties('AWS::Cognito::UserPool',{UserPoolTier:'ESSENTIALS',DeletionProtection:'ACTIVE',MfaConfiguration:'ON',EnabledMfas:['SOFTWARE_TOKEN_MFA'],AdminCreateUserConfig:{AllowAdminCreateUserOnly:true},EmailConfiguration:{EmailSendingAccount:'DEVELOPER',ConfigurationSet:`tracepoint-${environmentName}`,From:`TracePoint <notifications@${environmentName==='staging'?'staging.tracepointhq.com':'tracepointhq.com'}>`,SourceArn:Match.anyValue()}});
  template.hasResourceProperties('AWS::Cognito::UserPoolClient',{GenerateSecret:false,AllowedOAuthFlows:['code'],ExplicitAuthFlows:['ALLOW_USER_SRP_AUTH'],EnableTokenRevocation:true,RefreshTokenRotation:{Feature:'ENABLED',RetryGracePeriodSeconds:10},AccessTokenValidity:5,IdTokenValidity:5,
   CallbackURLs:[(environmentName==='staging'?'https://staging.tracepointhq.com':'https://tracepointhq.com')+'/api/auth/cognito/callback']});
  template.hasResource('AWS::Cognito::UserPool',{DeletionPolicy:'Retain'});
 });
 test(environmentName+' SES preview retains encrypted feedback and restricts sender IAM',()=>{
  const account=environmentName==='staging'?'559054714699':'111111111111';const app=new cdk.App();const root=new cdk.Stack(app,'roles',{env:{account,region:'us-east-1'}});const role=new iam.Role(root,'Task',{assumedBy:new iam.ServicePrincipal('ecs-tasks.amazonaws.com')});
  const stack=new SesFoundationStack(app,'email',{env:{account,region:'us-east-1'},environmentName,taskRole:role,mailFromSubdomain:'bounce'});const template=Template.fromStack(stack);
  template.hasResourceProperties('AWS::SES::EmailIdentity',{EmailIdentity:environmentName==='staging'?'staging.tracepointhq.com':'tracepointhq.com',MailFromAttributes:{BehaviorOnMxFailure:'REJECT_MESSAGE',MailFromDomain:'bounce.'+(environmentName==='staging'?'staging.tracepointhq.com':'tracepointhq.com')}});
  template.hasResourceProperties('AWS::SNS::Topic',{KmsMasterKeyId:Match.anyValue()});template.hasResourceProperties('AWS::KMS::Key',{EnableKeyRotation:true});
  template.hasResourceProperties('AWS::SES::ConfigurationSet',{SuppressionOptions:{SuppressedReasons:['BOUNCE','COMPLAINT']},DeliveryOptions:{TlsPolicy:'REQUIRE'}});
  template.resourceCountIs('AWS::SES::ConfigurationSet',2);
  template.hasResourceProperties('AWS::SES::ConfigurationSet',{Name:`tracepoint-${environmentName}-cognito`});
  template.resourceCountIs('AWS::SES::ConfigurationSetEventDestination',1);
  template.resourceCountIs('AWS::Route53::RecordSet',0);template.resourceCountIs('AWS::SNS::Subscription',1);template.resourceCountIs('AWS::SQS::Queue',2);template.hasResourceProperties('AWS::SQS::Queue',{SqsManagedSseEnabled:true,MessageRetentionPeriod:1209600,RedrivePolicy:{deadLetterTargetArn:Match.anyValue(),maxReceiveCount:5}});template.hasResourceProperties('AWS::SNS::Subscription',{RawMessageDelivery:false,Protocol:'sqs'});
  const policy=Object.values(template.findResources('AWS::IAM::Policy'))[0] as {Properties:{PolicyDocument:{Statement:Array<{Action:string;Condition:unknown}>}}};
  assert.equal(policy.Properties.PolicyDocument.Statement[0].Action,'ses:SendEmail');assert.ok(policy.Properties.PolicyDocument.Statement[0].Condition);
 });
}
test('provider stacks reject management and mismatched staging accounts',()=>{
 for(const account of ['265544358665','111111111111'])assert.throws(()=>new CognitoFoundationStack(new cdk.App(),'bad',{env:{account,region:'us-east-1'},environmentName:'staging',sesFromAddress:'notifications@staging.tracepointhq.com',sesConfigurationSetName:'tracepoint-staging'}),/boundary/);
});

test('disabled SES foundation grants no runtime authority and changes no DNS',()=>{
 const stack=new SesFoundationStack(new cdk.App(),'disabled',{env:{account:'559054714699',region:'us-east-1'},environmentName:'staging',mailFromSubdomain:'bounce'});const t=Template.fromStack(stack);
 t.resourceCountIs('AWS::IAM::Policy',0);t.resourceCountIs('AWS::IAM::Role',0);t.resourceCountIs('AWS::Route53::RecordSet',0);t.resourceCountIs('AWS::SES::EmailIdentity',1);
 t.hasOutput('ActivationGate',{Value:Match.stringLikeRegexp('^DISABLED:')});
});

test('SES feedback worker is private, bounded, partial-batch, and cannot send email',()=>{
 const app=new cdk.App(),root=new cdk.Stack(app,'root',{env:{account:'559054714699',region:'us-east-1'}});
 const vpc=new ec2.Vpc(root,'Vpc',{maxAzs:2,natGateways:0,subnetConfiguration:[{name:'isolated',subnetType:ec2.SubnetType.PRIVATE_ISOLATED,cidrMask:24}]});
 const databaseSecurityGroup=new ec2.SecurityGroup(root,'DatabaseSecurity',{vpc,allowAllOutbound:false});
 const databaseSecret=new secretsmanager.Secret(root,'DatabaseSecret');
 const ses=new SesFoundationStack(app,'email-worker-source',{env:{account:'559054714699',region:'us-east-1'},environmentName:'staging',mailFromSubdomain:'bounce'});
 const worker=new SesFeedbackWorkerStack(app,'email-worker',{env:{account:'559054714699',region:'us-east-1'},environmentName:'staging',vpc,databaseSecurityGroup,databaseSecret,feedbackTopic:ses.feedbackTopic,feedbackQueue:ses.feedbackQueue,feedbackDeadLetterQueue:ses.feedbackDeadLetterQueue});
 const template=Template.fromStack(worker),serialized=JSON.stringify(template.toJSON());
 template.hasResourceProperties('AWS::Lambda::Function',{Runtime:'nodejs24.x',Timeout:30,MemorySize:256,Environment:{Variables:Match.objectLike({TRACEPOINT_DATABASE_SECRET_ARN:Match.anyValue(),TRACEPOINT_SES_FEEDBACK_TOPIC_ARN:Match.anyValue(),TRACEPOINT_RDS_CA_PATH:'/opt/us-east-1-bundle.pem'})}});
 const functions=Object.values(template.findResources('AWS::Lambda::Function')) as Array<{Properties:Record<string,unknown>}>;
 assert.equal(Object.hasOwn(functions[0].Properties,'ReservedConcurrentExecutions'),false);
 template.hasResourceProperties('AWS::Lambda::EventSourceMapping',{BatchSize:10,FunctionResponseTypes:['ReportBatchItemFailures'],ScalingConfig:{MaximumConcurrency:2}});
 template.resourceCountIs('AWS::EC2::VPCEndpoint',1);template.resourceCountIs('AWS::CloudWatch::Alarm',4);
 assert.doesNotMatch(serialized,/com\.amazonaws\.us-east-1\.sns/);
 template.resourceCountIs('AWS::IAM::Role',1);
 const roles=Object.values(template.findResources('AWS::IAM::Role')) as Array<{Properties:Record<string,unknown>}>;
 assert.equal(Object.hasOwn(roles[0].Properties,'ManagedPolicyArns'),false);
 assert.doesNotMatch(serialized,/AWSLambdaBasicExecutionRole|AWSLambdaVPCAccessExecutionRole/);
 assert.match(serialized,/logs:CreateLogStream/);assert.match(serialized,/logs:PutLogEvents/);
 assert.match(serialized,/ec2:CreateNetworkInterface/);assert.match(serialized,/aws:RequestedRegion/);assert.match(serialized,/us-east-1/);
 assert.doesNotMatch(serialized,/"CidrIp":"0\.0\.0\.0\/0"/);
 assert.doesNotMatch(serialized,/ses:SendEmail|s3:GetObject|s3:PutObject/);
 assert.match(serialized,/secretsmanager:GetSecretValue/);
});
