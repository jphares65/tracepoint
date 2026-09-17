const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function readBearerToken(value: string | null | undefined) {
  if (!value) return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(value);
  if (!match || match[1].length > 16384 || !JWT_PATTERN.test(match[1])) {
    return undefined;
  }
  return match[1];
}
