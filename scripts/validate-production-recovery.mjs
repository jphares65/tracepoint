import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateProductionRecoveryAssembly} from './production-recovery-core.mjs';

export async function validateDirectory(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const templates = {};
  for (const [name, artifact] of Object.entries(manifest.artifacts ?? {})) {
    if (artifact.type === 'aws:cloudformation:stack' && name.startsWith('tracepoint-production-')) {
      templates[name] = JSON.parse(await readFile(join(root, artifact.properties.templateFile), 'utf8'));
    }
  }
  return validateProductionRecoveryAssembly({manifest, templates});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Provide the strict production synth output directory');
  const result = {...await validateDirectory(process.argv[2]), checkedAt:new Date().toISOString()};
  const outputIndex = process.argv.indexOf('--evidence');
  if (outputIndex >= 0) {
    if (!process.argv[outputIndex + 1]) throw new Error('--evidence requires a file path');
    await writeFile(resolve(process.argv[outputIndex + 1]), `${JSON.stringify(result, null, 2)}\n`, {flag:'wx'});
  }
  console.log(JSON.stringify(result, null, 2));
}

