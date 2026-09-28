import test from 'node:test';
import assert from 'node:assert/strict';
import { attestVercelProject, attestVercelVariables, attestVercelDeployment,
  VERCEL_TEAM_ID, VERCEL_PROJECT_ID, BASELINE_DEPLOYMENT_ID,
  BASELINE_GIT_SHA } from './production-vercel-rollback-core.mjs';

const project = { id: VERCEL_PROJECT_ID, accountId: VERCEL_TEAM_ID, name: 'tracepoint' };
const variables = [
  { id: 'envProduction1', key: 'SUPABASE_SECRET_KEY', target: ['production'], value: 'must-not-print' },
  { id: 'envPreview1', key: 'SUPABASE_SECRET_KEY', target: ['preview'], value: 'must-not-print' },
];
const deployment = { uid: BASELINE_DEPLOYMENT_ID, projectId: VERCEL_PROJECT_ID,
  target: 'production', readyState: 'READY', meta: { githubCommitSha: BASELINE_GIT_SHA } };

test('only the exact Vercel project, team, environment split, and deployment pass', () => {
  assert.equal(attestVercelProject(project), true);
  assert.deepEqual(attestVercelVariables(variables),
    { productionId: 'envProduction1', previewId: 'envPreview1' });
  assert.equal(attestVercelDeployment(deployment), true);
  assert.throws(() => attestVercelProject({ ...project, accountId: 'wrong' }));
  assert.throws(() => attestVercelVariables([variables[0], { ...variables[0] }]));
  assert.throws(() => attestVercelVariables([variables[0], { ...variables[0], target: ['preview'] }]));
  assert.throws(() => attestVercelDeployment({ ...deployment, meta: { githubCommitSha: 'wrong' } }));
});
