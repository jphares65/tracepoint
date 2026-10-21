import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';

// ADM-30: no stale page copies or editor backups beside the live sources.
const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const name=`${directory}/${entry.name}`;return entry.isDirectory()?walk(name):[name];});

test('ADM-30: root page copies and non-armory backups are gone, and the patterns are ignored',()=>{
  assert.deepEqual(readdirSync('.').filter(name=>name.endsWith('.txt')),[]);
  const stale=walk('src').filter(name=>/\.(bak|before-[^/]+)$|\.backup-\d/.test(name));
  // Armory backups are left for the armory batch (B8), which owns those files.
  assert.deepEqual(stale.filter(name=>!/^src\/app\/(api\/armory|firearms)\/|^src\/app\/components\/ArmoryWorkspaceNav\.tsx\./.test(name)),[]);
  const ignored=readFileSync('.gitignore','utf8').split(/\r?\n/);
  for(const pattern of ['*.backup-*','*.bak','*.bak-*','*.before-*'])assert.ok(ignored.includes(pattern),pattern);
});

test('ADM-30: the README describes TracePoint, not the create-next-app template',()=>{
  const readme=readFileSync('README.md','utf8');
  assert.doesNotMatch(readme,/create-next-app|Deploy on Vercel/);
  assert.match(readme,/^# TracePoint/);
  assert.match(readme,/database\/aws/);
});
