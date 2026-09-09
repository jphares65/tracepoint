import "server-only";
import { cookies } from "next/headers";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveRuntimeCognitoSession } from "./cognito-runtime-transport";
import { COGNITO_SESSION_COOKIE } from "./cognito-transport";
import { runtimeAuthenticationProvider, uniqueCookieValue, type AuthenticatedPrincipal } from "./request-session-core";

export async function resolveAuthenticatedPrincipal(cookieHeader?: string | null, environment = process.env): Promise<AuthenticatedPrincipal | null> {
  const provider = runtimeAuthenticationProvider(environment);
  if (provider === "cognito") {
    const header = cookieHeader ?? (await cookies()).getAll().map(({name,value})=>`${name}=${value}`).join("; ");
    const handle = uniqueCookieValue(header, COGNITO_SESSION_COOKIE);
    if (!handle) return null;
    const session = await resolveRuntimeCognitoSession(handle, environment);
    return session ? {userId:session.userId,provider:"cognito",issuer:session.issuer,subject:session.subject,email:"",fullName:""} : null;
  }
  const client = await createSupabaseServerClient();
  const result = await client.auth.getUser();
  const user = result.error ? null : result.data.user;
  if (!user) return null;
  const issuer = environment.NEXT_PUBLIC_SUPABASE_URL!;
  return {userId:user.id,provider:"supabase",issuer,subject:user.id,email:user.email??"",fullName:typeof user.user_metadata?.full_name==="string"?user.user_metadata.full_name:""};
}
