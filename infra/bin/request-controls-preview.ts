import * as cdk from 'aws-cdk-lib';
import {RequestControlsStack} from '../lib/request-controls-stack';
if(process.env.AWS_PROFILE||process.env.AWS_ACCESS_KEY_ID||process.env.AWS_SESSION_TOKEN)throw Error('Offline request-control preview must not inherit AWS credentials');
const app=new cdk.App();
for(const environment of ['staging','production'] as const){const account=environment==='staging'?'559054714699':'111111111111';new RequestControlsStack(app,'preview-'+environment,{env:{account,region:'us-east-1'},expectedAccount:account,environment,loadBalancerArn:`arn:aws:elasticloadbalancing:us-east-1:${account}:loadbalancer/app/preview/abc`,mode:'count'});}
