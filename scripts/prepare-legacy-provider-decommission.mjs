import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareLegacyProviderDecommission } from './legacy-provider-decommission-core.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidencePath = argument('--evidence');
  const outputPath = argument('--output');
  if (!evidencePath || !outputPath) throw new Error('Usage: node scripts/prepare-legacy-provider-decommission.mjs --evidence EVIDENCE.json --output PLAN.json');
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const plan = prepareLegacyProviderDecommission(evidence);
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ prepared: true, executionAuthorized: false, destructiveExecutionEnabled: false, contentSha256: plan.contentSha256 }));
}

