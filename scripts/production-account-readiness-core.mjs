import assert from 'node:assert/strict';

export function evaluateProductionAccountReadiness({identity, organization, accounts, policiesByAccount={}}) {
  assert.equal(identity?.Account, '559054714699', 'Account discovery must run from the staging evidence identity');
  assert.match(identity?.Arn ?? '', /^arn:aws:sts::559054714699:assumed-role\//);
  const result = {
    checkedFromAccount: identity.Account,
    checkedRegion: 'us-east-1',
    organizationMetadataVisible: Boolean(organization),
    accountInventoryAuthorized: Array.isArray(accounts),
    dedicatedProductionAccountExists: null,
    candidateCount: null,
    productionAccount: null,
    guardrailInspectionAuthorized: false,
    attachedScpCount: null,
    managementAccountUsedAsRuntime: false,
    mutationsPerformed: false,
  };
  if (!Array.isArray(accounts)) return result;
  const candidates = accounts.filter(account =>
    account?.Status === 'ACTIVE' &&
    !['265544358665','559054714699'].includes(account.Id) &&
    /tracepoint.*prod|prod.*tracepoint/i.test(account.Name ?? ''),
  );
  result.candidateCount = candidates.length;
  result.dedicatedProductionAccountExists = candidates.length === 1;
  if (candidates.length === 1) {
    result.productionAccount = candidates[0].Id;
    const policies = policiesByAccount[candidates[0].Id];
    result.guardrailInspectionAuthorized = Array.isArray(policies);
    result.attachedScpCount = Array.isArray(policies) ? policies.length : null;
  }
  return result;
}

