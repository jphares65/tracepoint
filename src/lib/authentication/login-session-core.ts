import { InvalidApplicationSessionCookieError } from "./request-session-core";

export type LoginSessionResolution<Principal> = {
  principal: Principal | null;
  requiresCleanup: boolean;
};

/**
 * Login is a terminal unauthenticated route. Its session probe must never make
 * rendering fail: a missing, expired, or malformed receipt is always handled
 * as anonymous local state. Unexpected resolver failures remain visible.
 */
export async function resolveLoginSession<Principal>(
  resolve: () => Promise<Principal | null>,
): Promise<LoginSessionResolution<Principal>> {
  try {
    const principal = await resolve();
    return principal
      ? { principal, requiresCleanup: false }
      : { principal: null, requiresCleanup: true };
  } catch (error) {
    if (error instanceof InvalidApplicationSessionCookieError) {
      return { principal: null, requiresCleanup: true };
    }
    throw error;
  }
}
