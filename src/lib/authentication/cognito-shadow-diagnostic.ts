// Temporary shadow/rehearsal diagnostics. Public production may not emit them.
// Call sites supply fixed branch names and non-secret booleans/numbers only.
export function shadowCognitoDiagnostic(branch: string, details: Record<string, boolean | number | null> = {}) {
  if (!shadowCognitoDiagnosticsEnabled()) return;
  console.warn(JSON.stringify({ event: 'shadow-cognito-callback-diagnostic', branch, ...details }));
}

export function shadowCognitoDiagnosticsEnabled() {
  return process.env.TRACEPOINT_NOTIFICATION_MODE === 'shadow' &&
    (process.env.NEXT_PUBLIC_SITE_URL === 'https://shadow.tracepointhq.com' ||
      process.env.NEXT_PUBLIC_SITE_URL === 'https://shadow-rehearsal.tracepointhq.com');
}
