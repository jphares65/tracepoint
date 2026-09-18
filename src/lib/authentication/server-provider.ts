import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuthenticationProvider } from './provider-core';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createMobileCognitoBearerResolver,
  isStagingCognitoBearerCandidate,
  stagingMobileCognitoConfiguration,
  SupabaseCognitoIdentityMappingStore,
  SupabaseCognitoMobileSessionStore,
} from './mobile-cognito-bearer';

// Callers must supply the request-scoped SSR client. Never accept a client or
// provider configuration from request parameters. Existing auth paths remain intact.
function assertSupabaseConfiguration(environment: NodeJS.ProcessEnv) {
  if ((environment.TRACEPOINT_AUTH_PROVIDER ?? 'supabase') !== 'supabase') throw new Error('Authentication provider activation is not approved by the runtime compatibility gate.');
  const issuer = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!issuer || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(issuer)) throw new Error('Invalid authentication issuer configuration.');
  return issuer;
}
export async function getServerAuthenticatedUser(client: SupabaseClient, environment = process.env, accessToken?: string) {
  if (accessToken && isStagingCognitoBearerCandidate(accessToken, environment)) {
    const config = stagingMobileCognitoConfiguration(environment);
    if (!config) return null;
    const admin = createAdminClient();
    const mobileAdmin = admin as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
    const mapping = new SupabaseCognitoIdentityMappingStore(mobileAdmin);
    const sessions = new SupabaseCognitoMobileSessionStore(mobileAdmin, mapping);
    const identity = await createMobileCognitoBearerResolver(config, mapping, sessions).resolve(accessToken);
    return identity ? { id: identity.userId, email: undefined, user_metadata: { full_name: undefined } } : null;
  }
  assertSupabaseConfiguration(environment);
  const result = await client.auth.getUser(accessToken);
  return result.error ? null : result.data.user;
}
export function createServerAuthenticationProvider(client: SupabaseClient, environment = process.env) {
  return new SupabaseAuthenticationProvider(assertSupabaseConfiguration(environment), () => getServerAuthenticatedUser(client, environment));
}
