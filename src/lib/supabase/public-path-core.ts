const publicPaths = [
  "/landing",
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/activate",
  "/api/health",
  "/api/notifications/email-dispatch",
];

const exactPublicPaths = new Set(["/support"]);

function pathMatches(pathname: string, path: string) {
  const normalizedPath = pathname.toLowerCase();
  const normalizedTarget = path.toLowerCase();

  return (
    normalizedPath === normalizedTarget ||
    normalizedPath.startsWith(`${normalizedTarget}/`)
  );
}

export function isSupabasePublicPath(pathname: string) {
  return (
    exactPublicPaths.has(pathname.toLowerCase()) ||
    publicPaths.some((path) => pathMatches(pathname, path))
  );
}
