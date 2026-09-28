import assert from 'node:assert/strict';

export const VERCEL_TEAM_ID = 'team_HCPS7YRtZfKg7WZtSDfjhaSR';
export const VERCEL_PROJECT_ID = 'prj_V03LJyQIc231luvZ9u0gcOAt4xK4';
export const BASELINE_DEPLOYMENT_ID = 'AfRHke111kN5zaHR7NGiMaqi4UMk';
export const BASELINE_GIT_SHA = '6588576ee2c3e95c2094e37c22ee64d0cbfad357';
export const VERCEL_TOKEN_SECRET = 'tracepoint/production/migration/vercel-cutover-operator-20260928';

export function attestVercelProject(project) {
  assert.equal(project?.id, VERCEL_PROJECT_ID, 'VERCEL_PROJECT_MISMATCH');
  assert.equal(project?.accountId, VERCEL_TEAM_ID, 'VERCEL_TEAM_MISMATCH');
  assert.equal(project?.name, 'tracepoint', 'VERCEL_PROJECT_NAME_MISMATCH');
  return true;
}

export function attestVercelVariables(variables) {
  assert.ok(Array.isArray(variables), 'VERCEL_ENV_LIST_REQUIRED');
  const elevated = variables.filter(entry => entry?.key === 'SUPABASE_SECRET_KEY');
  const exact = target => elevated.filter(entry =>
    Array.isArray(entry.target) ? entry.target.includes(target) : entry.target === target);
  const production = exact('production');
  const preview = exact('preview');
  assert.equal(production.length, 1, 'VERCEL_PRODUCTION_SECRET_AMBIGUOUS');
  assert.equal(preview.length, 1, 'VERCEL_PREVIEW_SECRET_AMBIGUOUS');
  assert.notEqual(production[0].id, preview[0].id, 'VERCEL_ENV_TARGETS_NOT_SEPARATE');
  assert.match(production[0].id ?? '', /^[A-Za-z0-9_]+$/, 'VERCEL_PRODUCTION_ENV_ID_INVALID');
  assert.match(preview[0].id ?? '', /^[A-Za-z0-9_]+$/, 'VERCEL_PREVIEW_ENV_ID_INVALID');
  return { productionId: production[0].id, previewId: preview[0].id };
}

export function attestVercelDeployment(deployment) {
  assert.equal(deployment?.uid ?? deployment?.id, BASELINE_DEPLOYMENT_ID, 'VERCEL_DEPLOYMENT_MISMATCH');
  assert.equal(deployment?.projectId, VERCEL_PROJECT_ID, 'VERCEL_DEPLOYMENT_PROJECT_MISMATCH');
  assert.equal(deployment?.target, 'production', 'VERCEL_DEPLOYMENT_TARGET_MISMATCH');
  assert.equal(deployment?.readyState, 'READY', 'VERCEL_DEPLOYMENT_NOT_READY');
  assert.equal(deployment?.meta?.githubCommitSha, BASELINE_GIT_SHA, 'VERCEL_DEPLOYMENT_CODE_MISMATCH');
  return true;
}
