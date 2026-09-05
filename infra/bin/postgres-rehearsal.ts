import * as cdk from 'aws-cdk-lib';
import {PostgresRehearsalStack} from '../lib/postgres-rehearsal-stack';
const app=new cdk.App();const run=app.node.tryGetContext('run');
if(app.node.tryGetContext('account')!=='559054714699'||app.node.tryGetContext('region')!=='us-east-1')throw Error('Explicit isolated staging account/region required');
new PostgresRehearsalStack(app,'tracepoint-postgres-rehearsal-'+run,{env:{account:'559054714699',region:'us-east-1'},run,imageDigest:app.node.tryGetContext('imageDigest'),engineVersion:app.node.tryGetContext('engineVersion'),tags:{Application:'TracePoint',Environment:'staging',Owner:'TracePoint',ManagedBy:'AWS-CDK'}});
