import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const normalizeMessage = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const relativePath = value => path.relative(process.cwd(), value).replaceAll('\\', '/');

export function normalizeLintResults(results) {
  const counts = new Map();
  for (const file of results) for (const message of file.messages ?? []) {
    const finding = {
      path: relativePath(file.filePath),
      ruleId: message.ruleId ?? 'eslint/fatal',
      severity: Number(message.severity) || 2,
      message: normalizeMessage(message.message),
    };
    const key = JSON.stringify(finding);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ ...JSON.parse(key), count }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function compareBaseline(baseline, current) {
  const expected = new Map(baseline.findings.map(item => [JSON.stringify({ path: item.path, ruleId: item.ruleId, severity: item.severity, message: item.message }), item.count]));
  const actual = new Map(current.map(item => [JSON.stringify({ path: item.path, ruleId: item.ruleId, severity: item.severity, message: item.message }), item.count]));
  const introduced = [];
  const removed = [];
  let remaining = 0;
  for (const [key, count] of actual) {
    const baselineCount = expected.get(key) ?? 0;
    remaining += Math.min(count, baselineCount);
    if (count > baselineCount) introduced.push({ ...JSON.parse(key), count: count - baselineCount });
  }
  for (const [key, count] of expected) {
    const currentCount = actual.get(key) ?? 0;
    if (count > currentCount) removed.push({ ...JSON.parse(key), count: count - currentCount });
  }
  return { baseline: baseline.findings.reduce((sum, item) => sum + item.count, 0), current: current.reduce((sum, item) => sum + item.count, 0), remaining, introduced, removed };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const resultsPath = option('--results');
  const baselinePath = option('--baseline');
  if (!resultsPath || !baselinePath) throw new Error('Usage: lint-ratchet.mjs --results <eslint-json> --baseline <baseline-json> [--write-baseline]');
  const current = normalizeLintResults(JSON.parse(await readFile(resultsPath, 'utf8')));
  if (args.includes('--write-baseline')) {
    await writeFile(baselinePath, `${JSON.stringify({ version: 1, findings: current }, null, 2)}\n`);
    console.log(JSON.stringify({ lintRatchet: 'baseline-written', findings: current.reduce((sum, item) => sum + item.count, 0), signatures: current.length }));
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    if (baseline.version !== 1 || !Array.isArray(baseline.findings)) throw new Error('Invalid lint baseline.');
    const report = compareBaseline(baseline, current);
    console.log(JSON.stringify({ lintRatchet: report }, null, 2));
    if (report.introduced.length) process.exitCode = 1;
  }
}
