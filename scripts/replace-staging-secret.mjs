import { execFileSync } from 'node:child_process';
import { validateStagingProviderConfig } from './validate-staging-provider-config.mjs';
// JSON arrives over stdin. Node serializes Windows argv correctly, avoiding
// PowerShell 5 native-argument quote loss. AWS errors never echo secret args.
const env = { ...process.env, AWS_REGION: 'us-east-1', AWS_DEFAULT_REGION: 'us-east-1' };
function aws(args) {
  try { return JSON.parse(execFileSync('aws.exe', [...args, '--region', 'us-east-1', '--output', 'json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw new Error('Staging secret operation failed; sensitive details suppressed'); }
}
function gate() {
  const identity = aws(['sts', 'get-caller-identity']);
  if (identity.Account !== '559054714699' || !identity.Arn.includes(':assumed-role/') || !identity.Arn.includes('TracePointMigrationStaging')) throw new Error('Staging identity mismatch');
}
try {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  let secret; try { secret = JSON.parse(input); } catch { throw new Error('Invalid staging secret JSON'); }
  gate();
  await validateStagingProviderConfig(secret);
  const keys = ['SUPABASE_SECRET_KEY', 'BREVO_API_KEY', 'NOTIFICATION_DISPATCH_SECRET', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SITE_URL', 'CONFIGURATION_ENVIRONMENT'];
  if (Object.keys(secret).length !== keys.length || keys.some(key => typeof secret[key] !== 'string' || !secret[key].trim())) throw new Error('Exactly eight nonempty staging fields are required');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) || ![16,24,32].includes(Buffer.from(secret.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, 'base64').length)) throw new Error('Invalid Server Actions AES key');
  if (secret.NOTIFICATION_DISPATCH_SECRET.length < 32) throw new Error('Notification secret must contain at least 32 characters');
  gate();
  const write = aws(['secretsmanager', 'put-secret-value', '--secret-id', 'tracepoint/staging/application', '--secret-string', JSON.stringify(secret)]);
  let readback; try { readback = JSON.parse(aws(['secretsmanager', 'get-secret-value', '--secret-id', 'tracepoint/staging/application', '--version-id', write.VersionId]).SecretString); } catch { throw new Error('Staging secret readback failed'); }
  if (keys.some(key => readback[key] !== secret[key])) throw new Error('Staging secret readback mismatch');
  console.log(JSON.stringify({ version: write.VersionId, verified: true, target: 'staging' }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
