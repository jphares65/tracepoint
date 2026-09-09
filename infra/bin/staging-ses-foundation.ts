import * as cdk from 'aws-cdk-lib';
import {SesFoundationStack} from '../lib/ses-foundation-stack';
const app=new cdk.App();
if(app.node.tryGetContext('account')!=='559054714699'||app.node.tryGetContext('region')!=='us-east-1'||app.node.tryGetContext('providerActivation')!=='disabled')throw Error('Explicit isolated staging target and disabled provider required');
new SesFoundationStack(app,'tracepoint-staging-ses-foundation',{env:{account:'559054714699',region:'us-east-1'},environmentName:'staging',mailFromSubdomain:'bounce',terminationProtection:true,tags:{Application:'TracePoint',Environment:'staging',Owner:'TracePoint',ManagedBy:'AWS-CDK',ProviderActivation:'disabled'}});
