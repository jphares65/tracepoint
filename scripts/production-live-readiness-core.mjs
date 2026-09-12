import assert from 'node:assert/strict';

const allowedCertificateAlgorithms = new Set([
  'RSA_2048',
  'RSA-2048',
  'EC_prime256v1',
  'EC-prime256v1',
  'EC_secp384r1',
  'EC-secp384r1',
]);

export function evaluateProductionLiveReadiness(input, now = Date.now()) {
  assert.match(input.account ?? '', /^\d{12}$/, 'Production account is invalid');
  assert.notEqual(input.account, '265544358665', 'Management account is forbidden');
  assert.notEqual(input.account, '559054714699', 'Staging account is forbidden');
  assert.equal(input.region, 'us-east-1', 'Production region must remain us-east-1');

  const identityVerified = input.identity?.Account === input.account
    && new RegExp(`^arn:aws:sts::${input.account}:assumed-role/TracePointMigrationProduction/[^/]+$`).test(input.identity?.Arn ?? '');
  const availabilityZonesVerified = ['us-east-1a', 'us-east-1b'].every(name =>
    input.availabilityZones?.some(zone => zone.ZoneName === name && zone.RegionName === input.region && zone.State === 'available'));
  const certificate = input.certificate ?? {};
  const certificateVerified = certificate.CertificateArn === input.certificateArn
    && certificate.DomainName === 'tracepointhq.com'
    && certificate.Status === 'ISSUED'
    && allowedCertificateAlgorithms.has(certificate.KeyAlgorithm)
    && Number.isFinite(Date.parse(certificate.NotAfter))
    && Date.parse(certificate.NotAfter) > now + 30 * 86400000
    && (certificate.DomainValidationOptions ?? []).length > 0
    && certificate.DomainValidationOptions.every(option => option.ValidationStatus === 'SUCCESS');
  const secretMetadataVerified = input.secretMetadata?.Name === 'tracepoint/production/application'
    && new RegExp(`^arn:aws:kms:us-east-1:${input.account}:key/[0-9a-f-]{36}$`).test(input.secretMetadata?.KmsKeyId ?? '');
  const cloudTrailVerified = (input.cloudTrails ?? []).length > 0
    && input.cloudTrails.every(trail => trail.IsLogging === true);
  const configVerified = (input.configurationRecorders ?? []).length > 0
    && input.configurationRecorders.every(recorder => recorder.recording === true);
  const guardDutyVerified = (input.guardDutyDetectors ?? []).length > 0
    && input.guardDutyDetectors.every(detector => detector.Status === 'ENABLED');
  const securityHubVerified = input.securityHubEnabled === true;
  const effectiveGuardrailsVerified = input.effectiveGuardrailsAuthorized === true
    && Number.isInteger(input.attachedScpCount)
    && input.attachedScpCount > 0;
  const productionBudgetVerified = (input.budgets ?? []).some(budget =>
    budget.BudgetName === 'tracepoint-production-monthly'
    && budget.BudgetType === 'COST'
    && Number(budget.BudgetLimit?.Amount) === 175
    && budget.BudgetLimit?.Unit === 'USD');

  const gates = {
    identityVerified,
    availabilityZonesVerified,
    certificateVerified,
    secretMetadataVerified,
    cloudTrailVerified,
    configVerified,
    guardDutyVerified,
    securityHubVerified,
    effectiveGuardrailsVerified,
    productionBudgetVerified,
  };
  return {
    account: input.account,
    region: input.region,
    ...gates,
    passed: Object.values(gates).every(Boolean),
    secretValueRead: false,
    mutationsPerformed: false,
  };
}
