import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Phase3bShadowStack } from '../lib/phase3b-shadow-stack';

const app = new cdk.App();
const stack = new Phase3bShadowStack(app, 'tracepoint-production-phase3b-shadow', {
  env: { account: '193644343389', region: 'us-east-1' },
});
const template = Template.fromStack(stack).toJSON();
const resources = Object.values(template.Resources) as Array<{ Type: string; Properties: Record<string, unknown> }>;
const ofType = (type: string) => resources.filter(resource => resource.Type === type);
const serialized = JSON.stringify(template);

assert.equal(ofType('AWS::ECS::Service').length, 1);
assert.equal(ofType('AWS::ECS::Service')[0].Properties.DesiredCount, 1);
assert.equal(ofType('AWS::Cognito::UserPoolClient').length, 1);
const shadowClient = ofType('AWS::Cognito::UserPoolClient')[0].Properties;
assert.equal(shadowClient.IdTokenValidity, 15);
assert.equal(shadowClient.AccessTokenValidity, 15);
assert.deepEqual(shadowClient.TokenValidityUnits, { IdToken: 'minutes', AccessToken: 'minutes' });
assert.equal(ofType('AWS::ElasticLoadBalancingV2::ListenerRule').length, 2);
assert.equal(ofType('AWS::Route53::RecordSet').length, 1);
assert.equal(ofType('AWS::EC2::SecurityGroupEgress').filter(resource => resource.Properties.GroupId === 'sg-0a7ba07ccc254d6b6').length, 1);
assert.equal(ofType('AWS::SecretsManager::Secret').length, 0);
assert.equal(ofType('AWS::RDS::DBInstance').length, 0);
assert.equal(ofType('AWS::ElasticLoadBalancingV2::LoadBalancer').length, 0);
assert.match(serialized, /76\.116\.100\.225\/32/);
assert.match(serialized, /50\.174\.33\.3\/32/);
assert.match(serialized, /4bb4bf51dfce02d2e41c112489b21ab310abdb583671872bd6d982883fe4ce5d/);
assert.match(serialized, /"Name":"HOSTNAME","Value":"0\.0\.0\.0"/);
assert.match(serialized, /tracepoint\/production\/shadow\/database-runtime-jNRvgT/);
assert.doesNotMatch(serialized, /tracepoint\/production\/database\/runtime-K4C4HY/);
assert.match(serialized, /TRACEPOINT_NOTIFICATION_MODE/);
assert.match(serialized, /shadow/);
assert.doesNotMatch(serialized, /NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(serialized, /cognito-idp:AdminCreateUser|ses:SendEmail|ses:SendRawEmail/);
console.log('Phase 3B shadow-only CDK contract PASS');
