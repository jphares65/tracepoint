export function isSupabaseSupportPath(pathname: string) {
  return pathname.toLowerCase() === "/support";
}

export function isSupabasePrivacyPath(pathname: string) {
  return pathname.toLowerCase() === "/privacy";
}
