import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const tag='a'.repeat(40)+'-aws-native-staging';

test('native staging application images use exactly the suffixed immutable tag contract',()=>{
 const buildspec=read('buildspec.staging-image.yml');
 const publisher=read('scripts/publish-tracepoint-staging-image.ps1');
 const workflow=read('.github/workflows/aws-staging-runtime.yml');
 assert.match(buildspec,/\^\(migration-\)\?\[0-9a-f\]\{40\}-aws-native-staging\$/);
 assert.match(publisher,/\$imageTag = "\$commit-aws-native-staging"/);
 assert.match(publisher,/name=IMAGE_TAG,value=\$imageTag,type=PLAINTEXT/);
 assert.match(publisher,/imageTag=\$imageTag/);
 assert.match(workflow,/RELEASE_COMMIT: \$\{\{ steps\.request\.outputs\.imageCommit \|\| github\.sha \}\}/);
 assert.match(workflow,/ImageTag "\$env:RELEASE_COMMIT-aws-native-staging"/);
});

test('release, deploy, evidence, and rollback consumers reject bare or mutable tags',()=>{
 const files=['scripts/release-tracepoint-staging.ps1','scripts/deploy-tracepoint-staging.ps1','scripts/collect-staging-release-evidence.mjs','scripts/rehearse-staging-rollback.ps1','scripts/invoke-tracepoint-staging-rollback.ps1'];
 for(const file of files){
  const text=read(file);
  assert.match(text,/\[0-9a-f\]\{40\}-aws-native-staging/);
  assert.doesNotMatch(text,/ValidatePattern\('\^\[0-9a-f\]\{40\}\$'\)/);
 }
 assert.match(read('scripts/collect-staging-release-evidence.mjs'),/sourceCommit:tag\.slice\(0,40\)/);
 assert.match(tag,/^[0-9a-f]{40}-aws-native-staging$/);
 for(const invalid of ['a'.repeat(40),'latest','migration-'+tag,'A'.repeat(40)+'-aws-native-staging'])assert.doesNotMatch(invalid,/^[0-9a-f]{40}-aws-native-staging$/);
});

test('migration tags remain distinct and retain the buildspec migration exception',()=>{
 const migrations=read('scripts/apply-app-migrations.ps1');
 const buildspec=read('buildspec.staging-image.yml');
 assert.match(migrations,/\$tag = "migration-\$Commit-aws-native-\$Environment"/);
 assert.match(buildspec,/\^\(migration-\)\?\[0-9a-f\]\{40\}-aws-native-staging\$/);
});
