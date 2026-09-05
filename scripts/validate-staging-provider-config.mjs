import { pathToFileURL } from 'node:url';
const origin = 'https://wztqqqashilusoppddxi.supabase.co';
function keyKind(key, expectedRole, prefix) {
  if (typeof key !== 'string') throw new Error('Missing staging Supabase key');
  if (new RegExp('^' + prefix + '[A-Za-z0-9_-]{20,}$').test(key)) return;
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) throw new Error('Malformed staging Supabase key');
  let payload;
  try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); }
  catch { throw new Error('Malformed staging Supabase JWT'); }
  if (payload.ref !== 'wztqqqashilusoppddxi' || payload.role !== expectedRole || (payload.exp && payload.exp * 1000 <= Date.now())) throw new Error('Staging Supabase JWT project, role or expiry mismatch');
}
export async function validateStagingProviderConfig(secret, fetchImpl = fetch, { email = true } = {}) {
  if (secret?.NEXT_PUBLIC_SUPABASE_URL !== origin || secret?.NEXT_PUBLIC_SITE_URL !== 'https://staging.tracepointhq.com' || secret?.CONFIGURATION_ENVIRONMENT !== 'staging') throw new Error('Staging provider target mismatch');
  keyKind(secret.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'anon', 'sb_publishable_');
  keyKind(secret.SUPABASE_SECRET_KEY, 'service_role', 'sb_secret_');
  if (email && (typeof secret.BREVO_API_KEY !== 'string' || !/^xkeysib-[A-Za-z0-9_-]{20,}$/.test(secret.BREVO_API_KEY))) throw new Error('Malformed staging Brevo key');
  for (const [path, key] of [['/auth/v1/settings', secret.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY], ['/auth/v1/admin/users?page=1&per_page=1', secret.SUPABASE_SECRET_KEY]]) {
    let response;
    try { response = await fetchImpl(origin + path, { headers: { apikey: key, Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Staging Supabase credential probe unavailable'); }
    const status = response.status;
    await response.body?.cancel(); // No auth/user response data is retained or printed.
    if (status !== 200) throw new Error('Staging Supabase credential probe rejected (HTTP ' + status + ')');
  }
  if (!email) return;
  let emailResponse;
  try { emailResponse = await fetchImpl('https://api.brevo.com/v3/account', { headers: { 'api-key': secret.BREVO_API_KEY }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Staging Brevo credential probe unavailable'); }
  await emailResponse.body?.cancel();
  if (emailResponse.status !== 200) throw new Error('Staging Brevo credential probe rejected (HTTP ' + emailResponse.status + ')');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    let secret;
    try { secret = JSON.parse(input); } catch { throw new Error('Invalid staging secret JSON'); }
    const email = !process.argv.includes('--supabase-only');
    await validateStagingProviderConfig(secret, fetch, {email});
    console.log(email ? 'Staging Supabase and Brevo probes passed.' : 'Staging Supabase probes passed; email is a separate deployment gate.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
