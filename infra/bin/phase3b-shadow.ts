#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Phase3bShadowStack } from '../lib/phase3b-shadow-stack';

const app = new cdk.App();
new Phase3bShadowStack(app, 'tracepoint-production-phase3b-shadow', {
  env: { account: '193644343389', region: 'us-east-1' },
  terminationProtection: true,
  description: 'Non-authoritative Phase 3B AWS-native shadow runtime; no public service ownership',
});
