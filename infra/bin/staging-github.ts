import * as cdk from 'aws-cdk-lib';
import {GitHubStagingStack} from '../lib/github-staging-stack';
const app=new cdk.App();if(app.node.tryGetContext('account')!=='559054714699'||app.node.tryGetContext('region')!=='us-east-1')throw Error('Explicit GitHub staging target required');
new GitHubStagingStack(app,'tracepoint-staging-github',{env:{account:'559054714699',region:'us-east-1'},terminationProtection:true,tags:{Application:'TracePoint',Environment:'staging',Owner:'TracePoint',ManagedBy:'AWS-CDK'}});
