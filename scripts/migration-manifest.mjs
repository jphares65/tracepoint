import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function rowsFingerprint(rows) {
  const hashes=rows.map(row=>sha256(canonical(row))).sort();
  return {count:hashes.length,sha256:sha256(hashes.join('\n'))};
}
export function compareManifests(before,after) {
  return canonical(before)===canonical(after);
}
export async function storageManifest(root) {
  const output=[];
  async function visit(directory) {
    for(const name of (await readdir(directory)).sort()) {
      const file=path.join(directory,name); const stat=await lstat(file);
      if(stat.isSymbolicLink()) throw new Error('Symlinks are not permitted in storage inventories');
      if(stat.isDirectory()) await visit(file);
      else if(stat.isFile()) {
        const hash=createHash('sha256'); for await(const chunk of createReadStream(file)) hash.update(chunk);
        output.push({key:path.relative(root,file).split(path.sep).join('/'),bytes:stat.size,sha256:hash.digest('hex')});
      } else throw new Error('Only regular files and directories are supported');
    }
  }
  await visit(path.resolve(root)); return {format:1,objects:output};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,a,b]=process.argv.slice(2);
  if(mode==='storage' && a) console.log(JSON.stringify(await storageManifest(a),null,2));
  else if(mode==='compare' && a && b) {
    const same=compareManifests(JSON.parse(await readFile(a,'utf8')),JSON.parse(await readFile(b,'utf8')));
    console.log(JSON.stringify({equal:same}));process.exitCode=same?0:1;
  } else throw new Error('Usage: node scripts/migration-manifest.mjs storage DIRECTORY | compare BEFORE.json AFTER.json');
}
