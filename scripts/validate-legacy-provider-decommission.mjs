import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateLegacyProviderDecommission } from './legacy-provider-decommission-core.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Provide a reviewed decommission evidence JSON file');
  const evidence = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = evaluateLegacyProviderDecommission(evidence);
  console.log(JSON.stringify({ ...result, executionAuthorized: false }, null, 2));
  if (!result.eligible) process.exitCode = 1;
}

