import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {CognitoFoundationStack} from '../lib/cognito-foundation-stack';
import {SesFoundationStack} from '../lib/ses-foundation-stack';
for(const environmentName of ['staging','production'] as const){
 test(environmentName+' Cognito uses short sessions, rotation, TOTP and exact callback domain',()=>{
  const account=environmentName==='staging'?'559054714699':'111111111111';const app=new cdk.App();
  const stack=new CognitoFoundationStack(app,'auth',{env:{account,region:'us-east-1'},environmentName});const template=Template.fromStack(stack);
  template.hasResourceProperties('AWS::Cognito::UserPool',{DeletionProtection:'ACTIVE',MfaConfiguration:'ON',EnabledMfas:['SOFTWARE_TOKEN_MFA'],AdminCreateUserConfig:{AllowAdminCreateUserOnly:true}});
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
  template.resourceCountIs('AWS::Route53::RecordSet',0);template.resourceCountIs('AWS::SNS::Subscription',0);
  const policy=Object.values(template.findResources('AWS::IAM::Policy'))[0] as {Properties:{PolicyDocument:{Statement:Array<{Action:string;Condition:unknown}>}}};
  assert.equal(policy.Properties.PolicyDocument.Statement[0].Action,'ses:SendEmail');assert.ok(policy.Properties.PolicyDocument.Statement[0].Condition);
 });
}
test('provider stacks reject management and mismatched staging accounts',()=>{
 for(const account of ['265544358665','111111111111'])assert.throws(()=>new CognitoFoundationStack(new cdk.App(),'bad',{env:{account,region:'us-east-1'},environmentName:'staging'}),/boundary/);
});
