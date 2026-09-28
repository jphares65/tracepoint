import assert from 'node:assert/strict';

export const VERCEL_TEAM_ID = 'team_HCPS7YRtZfKg7WZtSDfjhaSR';
export const VERCEL_PROJECT_ID = 'prj_V03LJyQIc231luvZ9u0gcOAt4xK4';
export const BASELINE_DEPLOYMENT_ID = 'AfRHke111kN5zaHR7NGiMaqi4UMk';
export const BASELINE_DEPLOYMENT_UID = `dpl_${BASELINE_DEPLOYMENT_ID}`;
export const BASELINE_GIT_SHA = '6588576ee2c3e95c2094e37c22ee64d0cbfad357';
export const VERCEL_TOKEN_SECRET = 'tracepoint/production/migration/vercel-cutover-operator-20260928';
export const PRODUCTION_SECRET_ENV_ID = 'e80TWGMDKlzEEkIJ';
export const PREVIEW_SECRET_ENV_ID = 'vHhZaYrgk5g0zNyI';

export function attestVercelProject(project) {
  assert.equal(project?.id, VERCEL_PROJECT_ID, 'VERCEL_PROJECT_MISMATCH');
  assert.equal(project?.accountId, VERCEL_TEAM_ID, 'VERCEL_TEAM_MISMATCH');
  assert.equal(project?.name, 'tracepoint', 'VERCEL_PROJECT_NAME_MISMATCH');
  assert.equal(project?.link?.type, 'github', 'VERCEL_GIT_PROVIDER_MISMATCH');
  assert.equal(project?.link?.org, 'jphares65', 'VERCEL_GIT_ORG_MISMATCH');
  assert.equal(project?.link?.repo, 'tracepoint', 'VERCEL_GIT_REPO_MISMATCH');
  assert.equal(project?.link?.productionBranch, 'main', 'VERCEL_PRODUCTION_BRANCH_MISMATCH');
  assert.ok(project?.link?.repoId != null, 'VERCEL_GIT_REPO_ID_MISSING');
  return true;
}

export function attestVercelVariables(variables) {
  assert.ok(Array.isArray(variables), 'VERCEL_ENV_LIST_REQUIRED');
  const elevated = variables.filter(entry => entry?.key === 'SUPABASE_SECRET_KEY');
  const exact = target => elevated.filter(entry => entry?.target?.includes(target));
  const production = exact('production');
  const preview = exact('preview');
  assert.equal(production.length, 1, 'VERCEL_PRODUCTION_SECRET_AMBIGUOUS');
  assert.equal(preview.length, 1, 'VERCEL_PREVIEW_SECRET_AMBIGUOUS');
  assert.equal(production[0].id, PRODUCTION_SECRET_ENV_ID, 'VERCEL_PRODUCTION_ENV_ID_MISMATCH');
  assert.equal(preview[0].id, PREVIEW_SECRET_ENV_ID, 'VERCEL_PREVIEW_ENV_ID_MISMATCH');
  for (const [entry, target] of [[production[0], 'production'], [preview[0], 'preview']]) {
    assert.deepEqual(entry.target, [target], `VERCEL_${target.toUpperCase()}_ENV_TARGET_MISMATCH`);
    assert.equal(entry.type, 'sensitive', `VERCEL_${target.toUpperCase()}_ENV_TYPE_MISMATCH`);
    assert.equal(entry.gitBranch ?? null, null, `VERCEL_${target.toUpperCase()}_ENV_BRANCH_MISMATCH`);
  }
  return { productionId: production[0].id, previewId: preview[0].id };
}

export function attestVercelDeployment(deployment) {
  assert.equal(deployment?.uid ?? deployment?.id, BASELINE_DEPLOYMENT_UID, 'VERCEL_DEPLOYMENT_MISMATCH');
  assert.equal(deployment?.projectId, VERCEL_PROJECT_ID, 'VERCEL_DEPLOYMENT_PROJECT_MISMATCH');
  assert.equal(deployment?.target, 'production', 'VERCEL_DEPLOYMENT_TARGET_MISMATCH');
  assert.equal(deployment?.readyState, 'READY', 'VERCEL_DEPLOYMENT_NOT_READY');
  assert.equal(deployment?.meta?.githubCommitSha, BASELINE_GIT_SHA, 'VERCEL_DEPLOYMENT_CODE_MISMATCH');
  return true;
}

// Prepare only; the caller must require active maintenance/source fencing and
// separately verify the resulting deployment and alias before making traffic live.
export function buildVercelSourceAbortRequests(project, variables, deployment, rollbackKey) {
  attestVercelProject(project);
  const { productionId } = attestVercelVariables(variables);
  attestVercelDeployment(deployment);
  assert.match(rollbackKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'ROLLBACK_MODERN_KEY_REQUIRED');
  const patch = Object.freeze({ method: 'PATCH',
    path: `/v9/projects/${VERCEL_PROJECT_ID}/env/${productionId}`,
    body: Object.freeze({ value: rollbackKey }) });
  const deploy = Object.freeze({ method: 'POST', path: '/v13/deployments?forceNew=1',
    body: Object.freeze({ name: 'tracepoint', project: VERCEL_PROJECT_ID,
      target: 'production',
      gitSource: Object.freeze({ type: 'github', repo: 'jphares65/tracepoint',
        ref: BASELINE_GIT_SHA }) }) });
  assert.equal('deploymentId' in deploy.body, false, 'OLD_DEPLOYMENT_ENV_INHERITANCE_FORBIDDEN');
  assert.equal('withLatestCommit' in deploy.body, false, 'UNPINNED_COMMIT_FORBIDDEN');
  return Object.freeze({ patch, deploy });
}
