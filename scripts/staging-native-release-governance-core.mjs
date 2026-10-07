export const NATIVE_RELEASE_BRANCH = 'codex/staging-mobile-api-release-20261007';
export const NATIVE_RELEASE_BASELINE = '5672b0395ff7082840d508488a7af07835263fc6';

export function validateNativeReleaseProvenance({ branch, head, baselineIsAncestor }) {
  if (branch !== NATIVE_RELEASE_BRANCH) throw new Error('The native release branch is not authorized.');
  if (!/^[0-9a-f]{40}$/.test(head ?? '')) throw new Error('The native release commit is invalid.');
  if (!baselineIsAncestor) throw new Error(`The native release must descend from ${NATIVE_RELEASE_BASELINE}.`);
  return true;
}
