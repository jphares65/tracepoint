import * as cdk from 'aws-cdk-lib';
import {RequestControlsStack} from '../lib/request-controls-stack';
const app=new cdk.App();
if(app.node.tryGetContext('account')!=='559054714699'||app.node.tryGetContext('region')!=='us-east-1')throw Error('Explicit staging request-control target required');
new RequestControlsStack(app,'tracepoint-staging-request-controls',{env:{account:'559054714699',region:'us-east-1'},expectedAccount:'559054714699',environment:'staging',loadBalancerArn:app.node.tryGetContext('loadBalancerArn'),mode:app.node.tryGetContext('mode'),terminationProtection:true,tags:{Application:'TracePoint',Environment:'staging',Owner:'TracePoint',ManagedBy:'AWS-CDK'}});
