import { sanitizeFixtureTaskFailure } from './staging-acceptance-evidence.mjs';

/** Converts only allowlisted PowerShell and fixture-runner fields into durable task evidence. */
export function captureFixtureTaskFailure(action, stage, result) {
  const output = [result?.stdout, result?.stderr].filter(value => typeof value === 'string' && value).join('\n');
  let diagnostic;
  for (const line of output.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed?.stagingAcceptanceFixture === 'failed') {
        diagnostic = Object.fromEntries(['stage', 'sqlstate', 'failureCode', 'operation', 'schema', 'table', 'column', 'routine', 'position', 'message', 'detail', 'hint', 'executionContext']
          .filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]]));
      }
    } catch { /* Only structured fixture diagnostics are retained. */ }
  }
  const classification = result?.error ? 'POWERSHELL_START_FAILED'
    : /CannotPullContainerError|CannotPullContainer/i.test(output) ? 'ECS_IMAGE_PULL_FAILED'
    : /AccessDenied(?:Exception)?/i.test(output) ? 'AWS_ACCESS_DENIED'
    : /stagingAcceptanceFixture["']?\s*:\s*["']failed/i.test(output) ? 'FIXTURE_DATABASE_FAILED'
    : /timed out|timeout/i.test(output) ? 'FIXTURE_TASK_TIMEOUT'
    : 'ECS_TASK_FAILED';
  const taskStopCode = output.match(/stop code\s+([^;\r\n]+)/i)?.[1]?.trim();
  const containerExitCode = output.match(/exit code\s+(\d+)/i)?.[1];
  return sanitizeFixtureTaskFailure({
    action, stage, classification,
    ...(Number.isInteger(result?.status) ? { processStatus: result.status } : {}),
    ...(result?.error?.code ? { processErrorCode: result.error.code } : {}),
    ...(taskStopCode ? { taskStopCode } : {}),
    ...(containerExitCode ? { containerExitCode: Number(containerExitCode) } : {}),
    ...(diagnostic ? { diagnostic } : {}),
  });
}
