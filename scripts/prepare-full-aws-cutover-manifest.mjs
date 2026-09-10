import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createCutoverManifest } from './full-aws-cutover-manifest-core.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidencePath = argument('--evidence');
  const outputPath = argument('--output');
  if (!evidencePath || !outputPath) throw new Error('Usage: node scripts/prepare-full-aws-cutover-manifest.mjs --evidence EVIDENCE.json --output MANIFEST.json');
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const manifest = createCutoverManifest(evidence);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ prepared: true, executionAuthorized: false, contentSha256: manifest.contentSha256 }));
}

