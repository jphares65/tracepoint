import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const account = '193644343389';
const region = 'us-east-1';
const finalHost = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const sourceCredentialArn = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/shadow/database-runtime-jNRvgT`;
const kmsKeyArn = `arn:aws:kms:${region}:${account}:key/4dc71990-3cfa-49d7-88c6-383bc1067f55`;

export class FinalTargetRuntimeSecretStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    if (this.account !== account || this.region !== region) {
      throw new Error('Exact final-target account and region are required.');
    }
    // The independently stored shadow credential originated from the approved
    // pre-import RDS baseline. CloudFormation resolves only its password field;
    // neither the template nor the local process handles the secret value.
    const secret = new secretsmanager.CfnSecret(this, 'FinalTargetRuntimeSecret', {
      name: 'tracepoint/production/final/database-runtime-20260926',
      description: 'Dormant AWS-native runtime credential pinned only to the final quarantined RDS target',
      kmsKeyId: kmsKeyArn,
      secretString: JSON.stringify({
        host: finalHost,
        port: 5432,
        username: 'tracepoint_runtime',
        password: `{{resolve:secretsmanager:${sourceCredentialArn}:SecretString:password}}`,
        dbname: 'tracepoint',
      }),
      tags: [
        { key: 'Application', value: 'TracePoint' },
        { key: 'Environment', value: 'production-migration-quarantined' },
        { key: 'Authority', value: 'non-authoritative-until-approved-cutover' },
      ],
    });
    secret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    new cdk.CfnOutput(this, 'FinalTargetRuntimeSecretArn', { value: secret.ref });
  }
}
