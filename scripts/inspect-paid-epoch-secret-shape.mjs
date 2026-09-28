#!/usr/bin/env node
// Reports only recognized envelope shapes; never prints a secret value.
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const names = [
  'tracepoint/production/migration/source-rehearsal-epoch-capture-20260927',
  'tracepoint/production/migration/source-rehearsal-epoch-rollback-20260927',
];
process.env.AWS_PROFILE = 'tracepoint-production';
process.env.AWS_SDK_LOAD_CONFIG = '1';
const client = new SecretsManagerClient({ region: 'us-east-1', maxAttempts: 1 });
try {
  for (const name of names) {
    const response = await client.send(new GetSecretValueCommand({ SecretId: name }));
    const value = response.SecretString ?? '';
    let format = /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(value) ? 'raw_modern' : 'other';
    let recognizedFields = [];
    if (format === 'other') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          format = 'json_object';
          recognizedFields = Object.keys(parsed).map(field =>
            /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(field) && !/secret|token|password/i.test(field)
              ? field : '<redacted-field>');
        } else format = 'json_non_object';
      } catch { /* No value or parse error detail is exposed. */ }
    }
    console.log(JSON.stringify({ name, format, recognizedFields, hasCurrentVersion: Boolean(response.VersionId) }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'SHAPE_INSPECTION_FAILED', code: error?.name ?? 'UNKNOWN' }));
  process.exitCode = 1;
} finally { client.destroy(); }
