const transientS3Codes = new Set([
  'ECONNABORTED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'TimeoutError', 'AbortError',
  'RequestTimeout', 'RequestTimeoutException', 'SlowDown', 'ServiceUnavailable', 'InternalError',
]);
const transientHttpStatuses = new Set([500, 502, 503, 504]);

/** Returns a stable, non-sensitive classification only for failures safe to retry. */
export function transientS3FailureCode(error) {
  const code = error?.code ?? error?.name ?? error?.Code;
  if (transientS3Codes.has(String(code ?? ''))) return String(code);
  const status = Number(error?.$metadata?.httpStatusCode ?? error?.statusCode ?? 0);
  return transientHttpStatuses.has(status) ? `HTTP_${status}` : undefined;
}

/** Retries only explicitly transient transport/service failures with bounded full-jitter backoff. */
export async function retryTransientS3(operation, {
  maxAttempts = 3,
  baseDelayMs = 250,
  maxDelayMs = 2000,
  random = Math.random,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof operation !== 'function' || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5 ||
      !Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new TypeError('Invalid bounded S3 retry configuration.');
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const classification = transientS3FailureCode(error);
      if (!classification || attempt >= maxAttempts) {
        if (error && typeof error === 'object') {
          try {
            Object.defineProperty(error, 's3RetryAttempts', { value: attempt, configurable: true });
            if (classification) Object.defineProperty(error, 's3RetryFailureCode', { value: classification, configurable: true });
          } catch { /* Preserve the original SDK error even when it is immutable. */ }
        }
        throw error;
      }
      const ceiling = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await sleep(Math.floor(random() * (ceiling + 1)));
    }
  }
}
