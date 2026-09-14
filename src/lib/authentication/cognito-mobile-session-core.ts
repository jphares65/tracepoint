import type { AuthenticationProvider } from "./provider-core";
import type { AuthenticatedPrincipal } from "./request-session-core";

export async function resolveVerifiedMobileBearer(
  token: string,
  provider: AuthenticationProvider,
  confirmProviderSession: (accessToken: string) => Promise<boolean>,
): Promise<AuthenticatedPrincipal | null> {
  if (!token || token.length > 16_384) return null;
  const identity = await provider.verifySession(token);
  if (!identity) return null;
  try {
    if (await confirmProviderSession(token) !== true) return null;
  } catch {
    return null;
  }
  return { ...identity, email: "", fullName: "" };
}
