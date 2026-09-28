#!/usr/bin/env node
// Exact-project read-only Firewall inventory; no token, rule payload or value is logged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_TEAM_ID, VERCEL_PROJECT_ID, VERCEL_TOKEN_SECRET }
  from './production-vercel-rollback-core.mjs';

const args = process.argv.slice(2);
assert.ok(JSON.stringify(args) === '["--profile=tracepoint-production"]' ||
  JSON.stringify(args) === '["--profile=tracepoint-production","--disposable"]',
  'EXACT_PROFILE_REQUIRED');
const projectId = args.includes('--disposable') ?
  'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw' : VERCEL_PROJECT_ID;
const aws = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
  ['secretsmanager', 'get-secret-value', '--secret-id', VERCEL_TOKEN_SECRET,
    '--query', 'SecretString', '--profile', 'tracepoint-production',
    '--region', 'us-east-1', '--output', 'text'], { encoding: 'utf8' });
assert.equal(aws.status, 0, 'VERCEL_TOKEN_UNAVAILABLE');
const raw = aws.stdout.trim();
const wrapper = raw.startsWith('{') ? JSON.parse(raw) : null;
if (wrapper) assert.deepEqual(Object.keys(wrapper), [VERCEL_TOKEN_SECRET]);
const token = wrapper ? wrapper[VERCEL_TOKEN_SECRET] : raw;
assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token));
const url = new URL('https://api.vercel.com/v1/security/firewall/config');
url.searchParams.set('projectId', projectId);
url.searchParams.set('teamId', VERCEL_TEAM_ID);
const response = await fetch(url, { method: 'GET', redirect: 'error',
  headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  signal: AbortSignal.timeout(15_000) });
assert.equal(response.status, 200, `VERCEL_FIREWALL_HTTP_${response.status}`);
const body = await response.json();
const active = body?.active ?? body;
const rules = active?.conditions ?? active?.rules ?? [];
assert.ok(Array.isArray(rules), 'VERCEL_FIREWALL_RULES_INVALID');
console.log(JSON.stringify({ status: 'PRODUCTION_VERCEL_FIREWALL_INVENTORIED',
  projectId, teamId: VERCEL_TEAM_ID,
  topLevelKeys: Object.keys(body ?? {}).filter(key => /^[A-Za-z_]{1,30}$/.test(key)),
  activeKeys: Object.keys(active ?? {}).filter(key => /^[A-Za-z_]{1,30}$/.test(key)),
  activeType: body?.active == null ? 'null' : typeof body.active,
  draftType: body?.draft == null ? 'null' : typeof body.draft,
  draftKeys: Object.keys(body?.draft ?? {}).filter(key => /^[A-Za-z_]{1,30}$/.test(key)),
  activeVersion: body?.active?.version ?? body?.active?.id ?? null,
  draftVersion: body?.draft?.version ?? body?.draft?.id ?? null,
  ruleCount: rules.length,
  rules: rules.map(rule => ({ id: rule.id ?? null, name: rule.name ?? null,
    active: rule.active ?? null,
    predicates: (rule.conditionGroup ?? []).flatMap(group => group.conditions ?? [])
      .map(item => ({ type: item.type ?? null, op: item.op ?? null,
        value: item.type === 'environment' ? item.value : undefined })) })),
  tokenLogged: false, mutated: false }));
