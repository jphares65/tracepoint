export type LoginSessionResolution<Principal> = {
  principal: Principal | null;
  requiresCleanup: boolean;
};

/**
 * Login is a terminal unauthenticated route. Its session probe must never make
 * rendering fail: a missing, expired, malformed, or unverifiable receipt is
 * always handled as anonymous local state that should be cleared.
 */
export async function resolveLoginSession<Principal>(
  resolve: () => Promise<Principal | null>,
): Promise<LoginSessionResolution<Principal>> {
  try {
    const principal = await resolve();
    return principal
      ? { principal, requiresCleanup: false }
      : { principal: null, requiresCleanup: true };
  } catch {
    return { principal: null, requiresCleanup: true };
  }
}
