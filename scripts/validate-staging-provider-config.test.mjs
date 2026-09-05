import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStagingProviderConfig } from './validate-staging-provider-config.mjs';
const secret = () => ({ BREVO_API_KEY: 'xkeysib-' + 'z'.repeat(32), CONFIGURATION_ENVIRONMENT: 'staging', NEXT_PUBLIC_SITE_URL: 'https://staging.tracepointhq.com', NEXT_PUBLIC_SUPABASE_URL: 'https://wztqqqashilusoppddxi.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(24), SUPABASE_SECRET_KEY: 'sb_secret_' + 'y'.repeat(24) });
test('rejects malformed keys before network calls', async () => {
  for (const name of ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
    const value = secret(); value[name] = '\\u0016';
    await assert.rejects(validateStagingProviderConfig(value, () => { throw new Error('Unexpected network'); }), /Malformed staging Supabase key/);
  }
});
test('rejects production targets before network calls', async () => {
  const value = secret(); value.NEXT_PUBLIC_SUPABASE_URL = 'https://izlkwggluhlhzlumtzes.supabase.co';
  await assert.rejects(validateStagingProviderConfig(value), /target mismatch/);
});
test('probes only isolated staging and discards response bodies', async () => {
  const calls = []; let canceled = 0;
  await validateStagingProviderConfig(secret(), async (url, options) => { calls.push(url); assert.equal(options.redirect, 'error'); return { status: 200, body: { cancel: async () => canceled++ } }; });
  assert.deepEqual(calls, ['https://wztqqqashilusoppddxi.supabase.co/auth/v1/settings', 'https://wztqqqashilusoppddxi.supabase.co/auth/v1/admin/users?page=1&per_page=1', 'https://api.brevo.com/v3/account']);
  assert.equal(canceled, 3);
});
test('rejects invalid admin credentials even if public settings pass', async () => {
  let calls = 0;
  await assert.rejects(validateStagingProviderConfig(secret(), async () => ({ status: ++calls === 1 ? 200 : 401 })), /HTTP 401/);
});
test('legacy JWT keys must match staging project and intended role', async () => {
  const value = secret(); value.SUPABASE_SECRET_KEY = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ref: 'izlkwggluhlhzlumtzes', role: 'service_role'})).toString('base64url') + '.signature';
  await assert.rejects(validateStagingProviderConfig(value), /project, role or expiry mismatch/);
});

test('Brevo credentials must pass their read-only probe', async () => {
  let calls = 0;
  await assert.rejects(validateStagingProviderConfig(secret(), async () => ({ status: ++calls < 3 ? 200 : 401 })), /Brevo.*HTTP 401/);
});

test('email blocker does not prevent independent auth acceptance', async () => {
  const value = secret(); value.BREVO_API_KEY = 'invalid'; let calls = 0;
  await validateStagingProviderConfig(value, async () => { calls++; return {status: 200}; }, {email: false});
  assert.equal(calls, 2);
});
