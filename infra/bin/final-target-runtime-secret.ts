import * as cdk from 'aws-cdk-lib';
import { FinalTargetRuntimeSecretStack } from '../lib/final-target-runtime-secret-stack';

const app = new cdk.App({ outdir: process.env.TRACEPOINT_FINAL_SECRET_SYNTH_OUTDIR });
new FinalTargetRuntimeSecretStack(app, 'tracepoint-production-final-target-runtime-secret', {
  env: { account: '193644343389', region: 'us-east-1' },
  terminationProtection: true,
  description: 'Non-authoritative final RDS runtime secret; never modifies the current public runtime secret or task.',
});
app.synth();
