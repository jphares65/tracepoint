import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuthenticationProvider } from './provider-core';

// Callers must supply the request-scoped SSR client. Never accept a client or
// provider configuration from request parameters. Existing auth paths remain intact.
function assertSupabaseConfiguration(environment: NodeJS.ProcessEnv) {
  if ((environment.TRACEPOINT_AUTH_PROVIDER ?? 'supabase') !== 'supabase') throw new Error('Authentication provider activation is not approved by the runtime compatibility gate.');
  const issuer = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!issuer || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(issuer)) throw new Error('Invalid authentication issuer configuration.');
  return issuer;
}
export async function getServerAuthenticatedUser(client: SupabaseClient, environment = process.env) {
  assertSupabaseConfiguration(environment);
  const result = await client.auth.getUser();
  return result.error ? null : result.data.user;
}
export function createServerAuthenticationProvider(client: SupabaseClient, environment = process.env) {
  return new SupabaseAuthenticationProvider(assertSupabaseConfiguration(environment), () => getServerAuthenticatedUser(client, environment));
}
