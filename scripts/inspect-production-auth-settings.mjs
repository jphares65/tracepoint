#!/usr/bin/env node
// Exact-project read-only GoTrue settings inventory; never print API keys.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ORIGIN = 'https://izlkwggluhlhzlumtzes.supabase.co';
const secret = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(secret.projectUrl, ORIGIN, 'PRODUCTION_SOURCE_SECRET_PROJECT_MISMATCH');
assert.ok(typeof secret.serviceRoleKey === 'string' && secret.serviceRoleKey.length > 20,
  'PRODUCTION_SOURCE_KEY_MISSING');
const response = await fetch(`${ORIGIN}/auth/v1/settings`, {
  method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
  headers: { apikey: secret.serviceRoleKey, Accept: 'application/json' },
});
assert.equal(response.status, 200, 'PRODUCTION_AUTH_SETTINGS_UNAVAILABLE');
const settings = await response.json();
const external = settings?.external;
assert.ok(external && typeof external === 'object' && !Array.isArray(external),
  'AUTH_PROVIDER_SETTINGS_MISSING');
const enabledProviders = Object.entries(external)
  .filter(([name, enabled]) => /^[a-z0-9_]+$/i.test(name) && enabled === true)
  .map(([name]) => name).sort();
console.log(JSON.stringify({ projectRef: 'izlkwggluhlhzlumtzes', httpStatus: response.status,
  enabledProviders, signupDisabled: settings.disable_signup === true,
  customerRowsRead: 0, credentialValuesEmitted: false, sourceMutation: false }));
