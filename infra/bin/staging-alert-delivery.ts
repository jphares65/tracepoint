import * as cdk from 'aws-cdk-lib';
import {AlertDeliveryStack} from '../lib/alert-delivery-stack';
const app=new cdk.App();
if(app.node.tryGetContext('account')!=='559054714699'||app.node.tryGetContext('region')!=='us-east-1')throw Error('Explicit staging alert target required');
new AlertDeliveryStack(app,'tracepoint-staging-alert-delivery',{env:{account:'559054714699',region:'us-east-1'},terminationProtection:true,tags:{Application:'TracePoint',Environment:'staging',Owner:'TracePoint',ManagedBy:'AWS-CDK'}});
