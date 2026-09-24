#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Phase3cRehearsalAppStack } from '../lib/phase3c-rehearsal-app-stack';

const app = new cdk.App();
new Phase3cRehearsalAppStack(app, 'tracepoint-production-phase3c-rehearsal-app', {
  env: { account: '193644343389', region: 'us-east-1' },
  terminationProtection: true,
  description: 'Isolated non-authoritative Phase 3C object-delivery rehearsal; no public or Phase 3B service ownership',
  imageDigest: app.node.tryGetContext('imageDigest'),
});
