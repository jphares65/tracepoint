import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { rollbackDecision, validateCutoverManifest } from './full-aws-cutover-manifest-core.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Provide an immutable full-AWS cutover manifest');
  const manifest = validateCutoverManifest(JSON.parse(await readFile(process.argv[2], 'utf8')));
  console.log(JSON.stringify({
    readyForOwnerAuthorizedExecution: true,
    executionAuthorized: false,
    contentSha256: manifest.contentSha256,
    phase: manifest.evidence.phase,
    rollback: rollbackDecision(manifest),
  }, null, 2));
}

