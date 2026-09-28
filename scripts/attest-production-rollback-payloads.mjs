#!/usr/bin/env node
// Read-only production rollback payload attestation. Never emits key values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PRODUCTION_EPOCH, extractProductionEpochKey } from './source-credential-epoch-core.mjs';
import { PRODUCTION_APPLICATION_SECRET, PRODUCTION_MIGRATION_REST_SECRET,
  PRODUCTION_ROLLBACK_SECRET, replaceBridgeElevatedKey,
  replaceMigrationRestKey } from './production-credential-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
function aws(args) {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'PINNED_AWS_READ_FAILED');
  return JSON.parse(result.stdout);
}
function secret(name) {
  const result = aws(['secretsmanager', 'get-secret-value', '--secret-id', name]);
  assert.equal(result.Name, name, 'SECRET_NAME_MISMATCH');
  assert.match(result.ARN ?? '', /^arn:aws:secretsmanager:us-east-1:193644343389:secret:/,
    'SECRET_ACCOUNT_MISMATCH');
  assert.equal(typeof result.SecretString, 'string');
  return result.SecretString;
}

let stage = 'identity';
try {
  assert.equal(aws(['sts', 'get-caller-identity']).Account, '193644343389');
  stage = 'secrets';
  const bridge = JSON.parse(secret(PRODUCTION_APPLICATION_SECRET));
  const migration = JSON.parse(secret(PRODUCTION_MIGRATION_REST_SECRET));
  const rollback = extractProductionEpochKey(secret(PRODUCTION_ROLLBACK_SECRET),
    PRODUCTION_EPOCH.rollbackSecretName);
  const old = migration.serviceRoleKey;
  stage = 'payload-contract';
  const nextBridge = replaceBridgeElevatedKey(bridge, old, rollback);
  const nextMigration = replaceMigrationRestKey(migration, old, rollback);
  assert.equal(nextBridge.SUPABASE_SECRET_KEY, nextMigration.serviceRoleKey);
  stage = 'ecs-binding';
  const services = aws(['ecs', 'describe-services', '--cluster', 'tracepoint-production',
    '--services', 'tracepoint-production']).services;
  assert.equal(services?.length, 1);
  const service = services[0];
  assert.equal(service.status, 'ACTIVE');
  assert.equal(service.taskDefinition,
    'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepointproductionruntimeServiceTaskDefA64ABA6A:4');
  const task = aws(['ecs', 'describe-task-definition', '--task-definition', service.taskDefinition])
    .taskDefinition;
  assert.equal(task.containerDefinitions?.length, 1);
  const refs = task.containerDefinitions[0].secrets.filter(item =>
    item.name === 'SUPABASE_SECRET_KEY' || item.name === 'SUPABASE_SERVICE_ROLE_KEY');
  assert.equal(refs.length, 2, 'BRIDGE_SECRET_REFS_MISSING');
  assert.ok(refs.every(item => item.valueFrom ===
    'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/application-mkGidl:SUPABASE_SECRET_KEY::'),
  'BRIDGE_SECRET_REF_DRIFT');
  console.log(JSON.stringify({ status: 'PRODUCTION_ROLLBACK_PAYLOADS_ATTESTED',
    sourceProject: PRODUCTION_EPOCH.projectRef, bridgeSecret: PRODUCTION_APPLICATION_SECRET,
    migrationSecret: PRODUCTION_MIGRATION_REST_SECRET,
    rollbackSecret: PRODUCTION_ROLLBACK_SECRET,
    bridgeTaskDefinition: service.taskDefinition, bridgeElevatedEnvNames: refs.map(item => item.name),
    replacementChangesOnlyElevatedField: true, rollbackDistinct: true,
    keyValuesLogged: false, mutations: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_ROLLBACK_PAYLOADS_BLOCKED', stage,
    code: /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'ATTESTATION_FAILED' }));
  process.exitCode = 2;
}
