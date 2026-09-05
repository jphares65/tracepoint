#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CognitoFoundationStack } from '../lib/cognito-foundation-stack';
import { SesFoundationStack } from '../lib/ses-foundation-stack';
// A separate offline assembly: normal staging releases never include these stacks.
for(const name of ['AWS_PROFILE','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','CDK_DEFAULT_ACCOUNT']){
 if(process.env[name])throw Error('Provider foundation preview requires an offline environment without AWS credentials.');
}
const app=new cdk.App();const stage=app.node.tryGetContext('environment');
if(stage!=='staging'&&stage!=='production')throw Error('Explicit staging or production preview required');
const account=stage==='staging'?'559054714699':'111111111111';
if(app.node.tryGetContext('account')!==account||app.node.tryGetContext('region')!=='us-east-1')throw Error('Preview account/region mismatch');
const common={env:{account,region:'us-east-1'},environmentName:stage,terminationProtection:true,
 tags:{Application:'TracePoint',Environment:stage,Owner:'TracePoint',ManagedBy:'AWS-CDK',PreviewOnly:'true'}};
new CognitoFoundationStack(app,'tracepoint-'+stage+'-cognito-preview',common);
const email=new cdk.Stack(app,'tracepoint-'+stage+'-email-role-preview',{env:common.env});
const role=iam.Role.fromRoleArn(email,'RuntimeRole',`arn:aws:iam::${account}:role/tracepoint-${stage}-task-preview`);
new SesFoundationStack(app,'tracepoint-'+stage+'-ses-preview',{...common,taskRole:role,mailFromSubdomain:app.node.tryGetContext('mailFromSubdomain')});
