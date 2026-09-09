import { createHash } from 'node:crypto';
export const storageHash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Backends return null only for a positively identified missing object.
// Existing conflicting bytes are never overwritten. The target's create method
// must use an atomic create-if-absent operation (S3 If-None-Match: *).
export async function reconcileStorageObjects({keys,source,target,copy=false}) {
 const seen=new Set();const objects=[];
 for(const key of keys){
  if(seen.has(key))throw new Error('Duplicate storage key');seen.add(key);
  const bytes=await source.read(key);if(!(bytes instanceof Uint8Array))throw new Error('Source object unavailable');
  const hash=storageHash(bytes);let existing=await target.read(key);let created=false;
  if(existing===null&&copy){await target.create(key,bytes);created=true;existing=await target.read(key);}
  if(existing!==null&&storageHash(existing)!==hash)throw new Error('Storage checksum conflict; no overwrite allowed');
  if(copy&&existing===null)throw new Error('Copied object is not readable');
  objects.push({keyHash:storageHash(key),bytes:bytes.length,sha256:hash,present:existing!==null,created});
 }
 objects.sort((a,b)=>a.keyHash.localeCompare(b.keyHash));return {format:1,objects,count:objects.length,verified:objects.every(x=>x.present),sha256:storageHash(JSON.stringify(objects.map(({keyHash,bytes,sha256})=>({keyHash,bytes,sha256}))))};
}
