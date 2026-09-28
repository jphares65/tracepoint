#!/usr/bin/env node
import assert from 'node:assert/strict';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SOURCE_CREDENTIALS, classifySourceSecret, fingerprintSourceSecret } from './source-credential-epoch-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
process.env.AWS_PROFILE = 'tracepoint-production';
process.env.AWS_SDK_LOAD_CONFIG = '1';
const client = new SecretsManagerClient({ region: 'us-east-1', maxAttempts: 1 });
try {
  for (const item of SOURCE_CREDENTIALS) {
    const response = await client.send(new GetSecretValueCommand({ SecretId: item.name }));
    assert.equal(typeof response.SecretString, 'string', 'STRING_SECRET_REQUIRED');
    const type = classifySourceSecret(response.SecretString, item.projectRef);
    const key = response.SecretString.startsWith('sb_secret_') ? response.SecretString :
      (JSON.parse(response.SecretString).serviceRoleKey ?? JSON.parse(response.SecretString).SUPABASE_SECRET_KEY);
    const read = await fetch(`https://${item.projectRef}.supabase.co/rest/v1/departments?select=id&limit=1`, {
      headers: { apikey: key, accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const readStatus = read.status;
    await read.arrayBuffer();
    assert.equal(readStatus, 200, 'EXACT_PROJECT_KEY_READ_FAILED');
    console.log(JSON.stringify({ secretName: item.name, projectRef: item.projectRef,
      credentialType: type, fingerprintSha256: fingerprintSourceSecret(response.SecretString, item.projectRef),
      versionIdPresent: typeof response.VersionId === 'string', exactProjectReadStatus: readStatus }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'SOURCE_CREDENTIAL_ATTESTATION_FAILED',
    code: error instanceof Error ? error.name : 'UNKNOWN' }));
  process.exitCode = 1;
} finally {
  client.destroy();
}
