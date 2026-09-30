export type SentryEvent = {
  breadcrumbs?: Array<Record<string, unknown>>;
  contexts?: Record<string, unknown>;
  exception?: { values?: Array<Record<string, unknown>> };
  extra?: Record<string, unknown>;
  logentry?: { message?: string; params?: unknown[] };
  message?: string;
  request?: { method?: string; url?: string; [key: string]: unknown };
  tags?: Record<string, unknown>;
  transaction?: string;
  user?: Record<string, unknown>;
  [key: string]: unknown;
};

const sensitiveKey = /(?:authorization|cookie|password|temporarypassword|access[_-]?token|refresh[_-]?token|id[_-]?token|code[_-]?verifier|mfa|totp|secret|api[_-]?key|credential|connection(?:[_-]?string)?|database(?:[_-]?url)?|aws[_-]?(?:access|secret|session)|x-amz|serial|ammunition|email|officer|personnel|tenant|agency|upload|attachment|document|evidence)/i;
const safeTag = new Set(["service", "runtime", "route", "http.status_code", "release", "commit", "environment"]);

function sanitizedText(value: string): string {
  if (/https?:\/\/[^\s]+[?&](?:x-amz-|access_token|refresh_token|id_token|code=|token=)/i.test(value)) return "[Filtered URL]";
  return value
    .replace(/\b(?:eyJ[A-Za-z0-9_-]+\.)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[Filtered token]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[Filtered AWS credential]")
    .replace(/(?:postgres(?:ql)?|mysql):\/\/[^\s"']+/gi, "[Filtered connection string]")
    .replace(/((?:password|temporarypassword|access[_-]?token|refresh[_-]?token|id[_-]?token|code[_-]?verifier|mfa|totp|authorization|cookie|secret|api[_-]?key|credential)\s*[:=]\s*)[^\s,;"'&]+/gi, "$1[Filtered]");
}

export function sanitizeRoute(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let pathname: string;
  try { pathname = new URL(value, "https://tracepoint.invalid").pathname; }
  catch { return undefined; }
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return "/";
  if (segments[0] === "api") return `/${segments.slice(0, 3).join("/")}`;
  return `/${segments[0]}`;
}

function sanitizeException(value: Record<string, unknown>): Record<string, unknown> {
  const stacktrace = value.stacktrace as Record<string, unknown> | undefined;
  const frames = Array.isArray(stacktrace?.frames)
    ? stacktrace.frames.map((frame) => {
        const candidate = frame as Record<string, unknown>;
        return { filename: typeof candidate.filename === "string" ? sanitizedText(candidate.filename) : undefined, function: typeof candidate.function === "string" ? sanitizedText(candidate.function) : undefined, lineno: candidate.lineno, colno: candidate.colno, in_app: candidate.in_app };
      })
    : undefined;
  return { type: typeof value.type === "string" ? sanitizedText(value.type) : undefined, value: typeof value.value === "string" ? sanitizedText(value.value) : undefined, stacktrace: frames ? { frames } : undefined };
}

export function sanitizeSentryEvent(event: SentryEvent): SentryEvent {
  const route = sanitizeRoute(event.transaction ?? event.request?.url);
  const tags = Object.fromEntries(Object.entries(event.tags ?? {}).flatMap(([key, value]) => safeTag.has(key) && !sensitiveKey.test(key) ? [[key, sanitizedText(String(value))]] : []));
  if (route) tags.route = route;
  return {
    ...event,
    message: typeof event.message === "string" ? sanitizedText(event.message) : undefined,
    logentry: event.logentry ? { message: sanitizedText(event.logentry.message ?? "") } : undefined,
    request: event.request ? { method: event.request.method, url: sanitizeRoute(event.request.url) } : undefined,
    transaction: route,
    tags,
    user: undefined,
    breadcrumbs: undefined,
    extra: undefined,
    contexts: Object.fromEntries(Object.entries(event.contexts ?? {}).filter(([key]) => ["browser", "runtime", "os"].includes(key))),
    exception: event.exception?.values ? { values: event.exception.values.map(sanitizeException) } : undefined,
  };
}
