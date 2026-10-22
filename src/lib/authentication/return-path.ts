// Post-sign-in return destination ("next"). One validator for every place a
// caller-supplied destination can become a redirect: the proxy, /login, the
// Cognito PKCE begin/callback pair and the idle sign-out hand-off.
//
// A return path is accepted only when it is a same-origin relative path that
// starts with exactly one "/". Every percent-decoding layer of the path must
// keep that shape (browsers and proxies may decode again), so "//", "/\",
// encoded slashes/backslashes, control characters and schemes are rejected.
// Authentication and API routes are never return destinations. Anything else
// falls back to My Home ("/").

export const DEFAULT_RETURN_PATH = "/";
export const MAX_RETURN_PATH_LENGTH = 2048;
// Host-only, Secure, HttpOnly. Set only by the idle sign-out hand-off and
// consumed (cleared) when the next sign-in starts or completes.
export const RETURN_PATH_COOKIE = "__Host-tracepoint-return-to";
export const RETURN_PATH_COOKIE_MAX_AGE_SECONDS = 900;

const BASE = "https://return-path.invalid";
const MAX_DECODE_LAYERS = 4;
// ASCII controls, DEL, backslash, whitespace and the Unicode line separators.
const UNSAFE_CHARACTER = /[\u0000-\u0020\u007f\\\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/;
// Exact routes and route prefixes (segment-bounded) that must never be a
// post-sign-in destination.
const BLOCKED_ROUTES = ["/login", "/activate", "/auth", "/api"];

function plainPathShape(value: string) {
  return value.startsWith("/") && value[1] !== "/" && !UNSAFE_CHARACTER.test(value);
}

function blockedRoute(pathname: string) {
  const value = pathname.toLowerCase();
  return BLOCKED_ROUTES.some((route) => value === route || value.startsWith(route + "/"));
}

function normalizedPathname(path: string) {
  const url = new URL(path, BASE);
  return url.origin === BASE ? url.pathname : null;
}

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RETURN_PATH_LENGTH) return null;
  // The raw value (still percent-encoded) must already be a plain path.
  if (!plainPathShape(value)) return null;
  const queryStart = value.search(/[?#]/);
  const rawPath = queryStart < 0 ? value : value.slice(0, queryStart);
  // Every decoding layer of the path must keep the same shape.
  let layer = rawPath;
  for (let depth = 0; ; depth += 1) {
    if (!plainPathShape(layer)) return null;
    let decoded: string;
    try { decoded = decodeURIComponent(layer); } catch { return null; }
    if (decoded === layer) break;
    if (depth + 1 >= MAX_DECODE_LAYERS) return null;
    layer = decoded;
  }
  let url: URL;
  try { url = new URL(value, BASE); } catch { return null; }
  if (url.origin !== BASE || !plainPathShape(url.pathname)) return null;
  // Check the route both as the URL parser normalizes it ("/x/../login") and
  // as a fully decoded path would route ("/%6Cogin", "/x/..%2Flogin").
  let decodedNormalized: string | null;
  try { decodedNormalized = normalizedPathname(layer); } catch { return null; }
  if (decodedNormalized === null || !plainPathShape(decodedNormalized)) return null;
  if (blockedRoute(url.pathname) || blockedRoute(layer) || blockedRoute(decodedNormalized)) return null;
  // The fragment never reaches the server; drop it.
  const result = url.pathname + url.search;
  return result.length <= MAX_RETURN_PATH_LENGTH ? result : null;
}

export function returnPathOrHome(value: unknown): string {
  return safeReturnPath(value) ?? DEFAULT_RETURN_PATH;
}

function cookieValues(cookieHeader: string | null | undefined, name: string) {
  return (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + "="))
    .map((part) => part.slice(name.length + 1));
}

export function hasReturnPathCookie(cookieHeader: string | null | undefined) {
  return cookieValues(cookieHeader, RETURN_PATH_COOKIE).length > 0;
}

// A duplicated or malformed cookie is ignored, never guessed at.
export function readReturnPathCookie(cookieHeader: string | null | undefined): string | null {
  const values = cookieValues(cookieHeader, RETURN_PATH_COOKIE);
  if (values.length !== 1 || !/^[A-Za-z0-9%._~!$&'()*+,;=:@/?-]{1,6200}$/.test(values[0])) return null;
  try { return safeReturnPath(decodeURIComponent(values[0])); } catch { return null; }
}

// Set-Cookie value; a null path clears the cookie.
export function returnPathSetCookie(path: string | null) {
  const safe = path === null ? null : safeReturnPath(path);
  const value = safe === null ? "" : encodeURIComponent(safe);
  const maxAge = safe === null ? 0 : RETURN_PATH_COOKIE_MAX_AGE_SECONDS;
  return `${RETURN_PATH_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// Reads exactly one "next" field from a small URL-encoded form body. Any other
// body (JSON, multipart, oversized, duplicated field) yields no return path.
export async function readFormReturnPath(request: Request, maxBytes = 4096): Promise<string | null> {
  try {
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded") return null;
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > maxBytes) return null;
    // Read at most maxBytes even when no Content-Length is declared.
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) return null;
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = new TextDecoder().decode(bytes);
    const values = new URLSearchParams(body).getAll("next");
    return values.length === 1 ? safeReturnPath(values[0]) : null;
  } catch {
    return null;
  }
}

// /login: an explicit ?next= wins; otherwise the idle sign-out hand-off cookie.
export function loginReturnPath(nextParameter: unknown, cookieHeader: string | null | undefined) {
  if (typeof nextParameter === "string" && nextParameter.length > 0) return returnPathOrHome(nextParameter);
  return readReturnPathCookie(cookieHeader) ?? DEFAULT_RETURN_PATH;
}
