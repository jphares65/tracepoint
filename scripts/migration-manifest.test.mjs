import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {rowsFingerprint,compareManifests,storageManifest} from './migration-manifest.mjs';
test('row reconciliation ignores order but detects duplicates, loss and content changes',()=>{
 const rows=[{id:1,name:'A'},{name:'B',id:2}];
 assert.deepEqual(rowsFingerprint(rows),rowsFingerprint([{id:2,name:'B'},{name:'A',id:1}]));
 for(const other of [rows.slice(1),[...rows,rows[0]],[{id:1,name:'changed'},rows[1]]]) assert.notDeepEqual(rowsFingerprint(rows),rowsFingerprint(other));
});
test('storage reconciliation detects equal-size corruption and missing files',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'tracepoint-manifest-'));
 try{
  await writeFile(path.join(root,'file'),'abc');const before=await storageManifest(root);
  assert.equal(compareManifests(before,await storageManifest(root)),true);
  await writeFile(path.join(root,'file'),'xyz');assert.equal(compareManifests(before,await storageManifest(root)),false);
  await rm(path.join(root,'file'));assert.equal(compareManifests(before,await storageManifest(root)),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
