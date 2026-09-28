import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attestVercelProject, attestVercelVariables, attestVercelDeployment,
  buildVercelSourceAbortRequests,
  VERCEL_TEAM_ID, VERCEL_PROJECT_ID, BASELINE_DEPLOYMENT_UID,
  BASELINE_GIT_SHA, PRODUCTION_SECRET_ENV_ID, PREVIEW_SECRET_ENV_ID
} from './production-vercel-rollback-core.mjs';

const project = { id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID, name: 'tracepoint',
  link: { type: 'github', org: 'jphares65', repo: 'tracepoint', repoId: 123,
    productionBranch: 'main' } };
const variables = [
  { id: PRODUCTION_SECRET_ENV_ID, key: 'SUPABASE_SECRET_KEY', target: ['production'],
    type: 'sensitive', value: 'must-not-print' },
  { id: PREVIEW_SECRET_ENV_ID, key: 'SUPABASE_SECRET_KEY', target: ['preview'],
    type: 'sensitive', value: 'must-not-print' },
];
const deployment = { uid: BASELINE_DEPLOYMENT_UID, projectId: VERCEL_PROJECT_ID,
  target: 'production', readyState: 'READY', meta: { githubCommitSha: BASELINE_GIT_SHA } };

test('only the exact Vercel project, team, environment split, and deployment pass', () => {
  assert.equal(attestVercelProject(project), true);
  assert.deepEqual(attestVercelVariables(variables),
    { productionId: PRODUCTION_SECRET_ENV_ID, previewId: PREVIEW_SECRET_ENV_ID });
  assert.equal(attestVercelDeployment(deployment), true);
  assert.throws(() => attestVercelProject({ ...project, accountId: 'wrong' }));
  assert.throws(() => attestVercelProject({ ...project, link: { ...project.link, org: 'wrong' } }));
  assert.throws(() => attestVercelVariables([variables[0], { ...variables[0] }]));
  assert.throws(() => attestVercelVariables([variables[0], { ...variables[0], target: ['preview'] }]));
  assert.throws(() => attestVercelVariables([
    { ...variables[0], target: ['production', 'preview'] }, variables[1]]));
  assert.throws(() => attestVercelVariables([
    { ...variables[0], type: 'encrypted' }, variables[1]]));
  assert.throws(() => attestVercelVariables([
    { ...variables[0], gitBranch: 'main' }, variables[1]]));
  assert.throws(() => attestVercelVariables([
    { ...variables[0], id: 'other' }, variables[1]]));
  assert.throws(() => attestVercelDeployment({ ...deployment, meta: { githubCommitSha: 'wrong' } }));
});

test('live inventory script is read-only and emits identifiers, never values', () => {
  const source = readFileSync(new URL('./inspect-production-vercel-rollback.mjs', import.meta.url), 'utf8');
  assert.match(source, /method: 'GET'/);
  assert.doesNotMatch(source, /method: '(?:POST|PATCH|PUT|DELETE)'/);
  assert.match(source, /tokenValueLogged: false, environmentValuesLogged: false/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:token|variableResult|deployment)\)/);
});

test('source abort patches only Production and builds pinned Git code with fresh environment', () => {
  const replacement = `sb_secret_${'r'.repeat(32)}`;
  const plan = buildVercelSourceAbortRequests(project, variables, deployment, replacement);
  assert.equal(plan.patch.method, 'PATCH');
  assert.equal(plan.patch.path, `/v9/projects/${VERCEL_PROJECT_ID}/env/${PRODUCTION_SECRET_ENV_ID}`);
  assert.deepEqual(plan.patch.body, { value: replacement });
  assert.equal(plan.deploy.method, 'POST');
  assert.equal(plan.deploy.path, '/v13/deployments?forceNew=1');
  assert.deepEqual(plan.deploy.body, { name: 'tracepoint', project: VERCEL_PROJECT_ID,
    target: 'production', gitSource: { type: 'github', repo: 'jphares65/tracepoint',
      ref: BASELINE_GIT_SHA } });
  assert.equal('deploymentId' in plan.deploy.body, false);
  assert.throws(() => buildVercelSourceAbortRequests(project, variables, deployment, 'not-a-key'));
  assert.throws(() => buildVercelSourceAbortRequests(project, [variables[1]], deployment, replacement));
});
