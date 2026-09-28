#!/usr/bin/env node
// Exact live TracePoint Vercel project only. --check is read-only. Mutation
// modes require active public maintenance and a recorded cutover window.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_TEAM_ID, VERCEL_PROJECT_ID, VERCEL_TOKEN_SECRET,
  attestVercelProject, withExactVercelTeam } from './production-vercel-rollback-core.mjs';

const [profile, mode, windowArg] = process.argv.slice(2);
assert.equal(profile, '--profile=tracepoint-production', 'EXACT_PROFILE_REQUIRED');
assert.ok(['--check', '--enable', '--remove-production', '--remove-preview'].includes(mode),
  'EXACT_MODE_REQUIRED');
if (mode === '--check') assert.equal(windowArg, undefined, 'CHECK_HAS_NO_WINDOW');
else {
  assert.match(windowArg ?? '', /^--window-id=[A-Za-z0-9-]{8,64}$/,
    'EXACT_WINDOW_ID_REQUIRED');
  assert.equal(process.env.TRACEPOINT_CUTOVER_WINDOW_APPROVED, 'YES',
    'CUTOVER_WINDOW_FLAG_REQUIRED');
}
const ruleNames = Object.freeze({
  preview: 'TracePoint cutover preview deny 20260928',
  production: 'TracePoint cutover production deny 20260928',
});
function aws(args, output = 'json') {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1',
      '--output', output], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'PINNED_AWS_CALL_FAILED');
  return output === 'json' ? JSON.parse(result.stdout) : result.stdout.trim();
}
async function request(token, method, path, body) {
  const response = await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`,
    { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await response.json(); } catch { /* status authoritative */ }
  assert.equal(response.status, 200, `VERCEL_${method}_HTTP_${response.status}`);
  return json;
}
const configPath = `/v1/security/firewall/config?projectId=${VERCEL_PROJECT_ID}`;
async function config(token) {
  const result = await request(token, 'GET', configPath);
  assert.ok(result && typeof result === 'object', 'VERCEL_CONFIG_INVALID');
  assert.equal(result.draft, null, 'VERCEL_FIREWALL_DRAFT_PRESENT');
  return result.active?.rules ?? [];
}
function assertExactRule(rule, environment) {
  assert.equal(rule?.name, ruleNames[environment], 'VERCEL_RULE_NAME_DRIFT');
  assert.equal(rule.active, true, 'VERCEL_RULE_NOT_ACTIVE');
  assert.equal(rule.action?.mitigate?.action, 'deny', 'VERCEL_RULE_NOT_DENY');
  assert.equal(rule.conditionGroup?.length, 1, 'VERCEL_RULE_GROUP_DRIFT');
  assert.equal(rule.conditionGroup[0]?.conditions?.length, 1,
    'VERCEL_RULE_CONDITION_COUNT_DRIFT');
  const condition = rule.conditionGroup[0].conditions[0];
  assert.equal(condition.type, 'environment', 'VERCEL_RULE_TYPE_DRIFT');
  assert.equal(condition.op, 'eq', 'VERCEL_RULE_OPERATOR_DRIFT');
  assert.equal(condition.value, environment, 'VERCEL_RULE_VALUE_DRIFT');
  assert.ok(condition.neg === false || condition.neg == null,
    'VERCEL_RULE_NEGATED');
  assert.match(rule.id ?? '', /^rule_[A-Za-z0-9_-]+$/, 'VERCEL_RULE_ID_INVALID');
}
async function requirePublicMaintenance() {
  const response = await fetch('https://www.tracepointhq.com/landing', {
    redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: { 'cache-control': 'no-cache' } });
  await response.arrayBuffer();
  assert.equal(response.status, 503, 'PUBLIC_MAINTENANCE_NOT_ACTIVE');
}
async function waitProductionDeny() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch('https://tracepoint-amber.vercel.app/landing', {
      redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { 'cache-control': 'no-cache' } });
    await response.arrayBuffer();
    if (response.status === 403) return;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('VERCEL_PRODUCTION_DENY_NOT_EXTERNAL');
}
let stage = 'identity';
try {
  assert.equal(aws(['sts', 'get-caller-identity']).Account, '193644343389',
    'PRODUCTION_ACCOUNT_REQUIRED');
  const raw = aws(['secretsmanager', 'get-secret-value', '--secret-id',
    VERCEL_TOKEN_SECRET, '--query', 'SecretString'], 'text');
  const wrapped = raw.startsWith('{') ? JSON.parse(raw) : null;
  if (wrapped) assert.deepEqual(Object.keys(wrapped), [VERCEL_TOKEN_SECRET]);
  const token = wrapped ? wrapped[VERCEL_TOKEN_SECRET] : raw;
  assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token),
    'VERCEL_TOKEN_INVALID');
  stage = 'project';
  attestVercelProject(await request(token, 'GET', `/v9/projects/${VERCEL_PROJECT_ID}`));
  if (mode !== '--check') await requirePublicMaintenance();
  stage = 'firewall';
  let rules = await config(token);
  if (mode === '--check') {
    const related = rules.filter(rule => Object.values(ruleNames).includes(rule.name));
    for (const rule of related) {
      const env = rule.name === ruleNames.production ? 'production' : 'preview';
      assertExactRule(rule, env);
    }
    console.log(JSON.stringify({ status: 'PRODUCTION_VERCEL_DENY_PRECHECK',
      projectId: VERCEL_PROJECT_ID, existingRuleCount: rules.length,
      cutoverPreviewActive: related.some(rule => rule.name === ruleNames.preview),
      cutoverProductionActive: related.some(rule => rule.name === ruleNames.production),
      mutated: false, tokenLogged: false }));
  } else if (mode === '--enable') {
    assert.equal(rules.length, 0, 'VERCEL_EXISTING_RULES_NOT_REVIEWED');
    for (const env of ['preview', 'production']) {
      stage = `insert-${env}`;
      await request(token, 'PATCH', configPath, { action: 'rules.insert', id: null,
        value: { active: true, name: ruleNames[env],
          description: 'Temporary TracePoint source-writer cutover barrier',
          conditionGroup: [{ conditions: [{ type: 'environment', op: 'eq', value: env }] }],
          action: { mitigate: { action: 'deny' } } } });
      rules = await config(token);
      const matches = rules.filter(rule => rule.name === ruleNames[env]);
      assert.equal(matches.length, 1, 'VERCEL_INSERTED_RULE_NOT_UNIQUE');
      assertExactRule(matches[0], env);
    }
    assert.equal(rules.length, 2, 'VERCEL_CUTOVER_RULE_SET_DRIFT');
    await waitProductionDeny();
    console.log(JSON.stringify({ status: 'PRODUCTION_VERCEL_CUTOVER_DENY_ACTIVE',
      projectId: VERCEL_PROJECT_ID, previewRuleId: rules.find(rule => rule.name === ruleNames.preview)?.id,
      productionRuleId: rules.find(rule => rule.name === ruleNames.production)?.id,
      productionExternalStatus: 403, sourceAuthorityUnchanged: true, tokenLogged: false }));
  } else {
    const env = mode === '--remove-production' ? 'production' : 'preview';
    stage = `remove-${env}`;
    const matches = rules.filter(rule => rule.name === ruleNames[env]);
    assert.equal(matches.length, 1, 'VERCEL_RULE_TO_REMOVE_NOT_UNIQUE');
    assertExactRule(matches[0], env);
    await request(token, 'PATCH', configPath, { action: 'rules.remove', id: matches[0].id });
    rules = await config(token);
    assert.equal(rules.some(rule => rule.id === matches[0].id), false,
      'VERCEL_RULE_REMOVE_NOT_VISIBLE');
    console.log(JSON.stringify({ status: 'PRODUCTION_VERCEL_CUTOVER_DENY_RULE_REMOVED',
      projectId: VERCEL_PROJECT_ID, environment: env,
      remainingCutoverRules: rules.filter(rule => Object.values(ruleNames).includes(rule.name)).length,
      tokenLogged: false }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_VERCEL_CUTOVER_DENY_BLOCKED', stage,
    code: /^[A-Z0-9_:]+$/.test(error?.message ?? '') ? error.message : 'CONTROL_FAILED',
    keepMaintenanceAndSourceFence: mode !== '--check' }));
  process.exitCode = 2;
}
