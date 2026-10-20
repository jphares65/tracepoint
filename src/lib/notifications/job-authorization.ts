import { createHash, timingSafeEqual } from "node:crypto";

// Scheduled notification jobs authenticate with the dispatch bearer secret
// only; the request proxy lets these exact paths through (TRN-08), so this
// check is the whole boundary. Digests keep the comparison constant-time.
export function authorizedNotificationJob(
  authorization: string | null,
  environment: Record<string, string | undefined> = process.env,
) {
  const secret = environment.NOTIFICATION_DISPATCH_SECRET || environment.CRON_SECRET;
  if (!secret) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${secret}`));
}
