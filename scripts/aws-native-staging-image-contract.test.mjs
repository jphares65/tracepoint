import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const tag='a'.repeat(40)+'-aws-native-staging';

test('native staging application images use exactly the suffixed immutable tag contract',()=>{
 const buildspec=read('buildspec.staging-image.yml');
 const publisher=read('scripts/publish-tracepoint-staging-image.ps1');
 const dockerfile=read('Dockerfile');
 const workflow=read('.github/workflows/aws-staging-runtime.yml');
 assert.match(buildspec,/\^\(migration-\)\?\[0-9a-f\]\{40\}-aws-native-staging\$/);
 assert.match(publisher,/\$imageTag = Get-ReviewedImageTag -Environment staging -Commit \$commit/);
 assert.match(publisher,/name=IMAGE_TAG,value=\$imageTag,type=PLAINTEXT/);
 assert.match(publisher,/imageTag=\$imageTag/);
 assert.match(dockerfile,/node scripts\/lint-ratchet\.mjs --results "\$lint_results" --baseline lint-baseline\.json/);
 assert.match(dockerfile,/timeout 20m node scripts\/run-application-tests\.mjs/);
 assert.match(dockerfile,/timeout 5m node --test scripts\/aws-native-migrations\.test\.mjs/);
 assert.match(dockerfile,/mobile-route-image-contract-core\.mjs --source-root \/app --next-root \/app\/\.next/);
 assert.match(buildspec,/test-staging-image-mobile-routes\.sh/);
 assert.match(buildspec,/grep -q \$'\\\\r' scripts\/test-staging-image-mobile-routes\.sh/);
 assert.match(read('.gitattributes'),/scripts\/test-staging-image-mobile-routes\.sh text eol=lf/);
 assert.match(buildspec,/mobile-route-image-contract-core\.mjs --next-root \/app\/\.next/);
 // The archive contents and their checks live in TracePoint.Staging.psm1; the publisher uses them.
 const stagingModule=read('scripts/TracePoint.Staging.psm1');
 assert.match(publisher,/Get-TracePointStagingImageArchiveIncludes/);
 assert.match(publisher,/Assert-TracePointStagingImageArchive -EntryNames \$entryNames -TrackedPaths \$trackedPaths/);
 for(const include of ["'scripts'","'database/aws'","'database/rehearsal'","'supabase/migrations'","'lint-baseline.json'","'infra/lib/production-target.ts'"])assert.ok(stagingModule.includes(include),include);
 for(const required of ["'scripts/run-application-tests.mjs'","'scripts/lint-ratchet.mjs'","'lint-baseline.json'"])assert.ok(stagingModule.includes(required),required);
 // Schema fixtures are the only SQL allowed into the build source; they are test inputs, never executed by the release.
 assert.match(stagingModule,/\(\?:database\/aws\|database\/rehearsal\|supabase\/migrations\)/);
 assert.match(workflow,/RELEASE_COMMIT: \$\{\{ steps\.request\.outputs\.imageCommit \|\| github\.sha \}\}/);
 assert.match(workflow,/ImageTag "\$env:RELEASE_COMMIT-aws-native-staging"/);
});

test('normal release consumers reject bare or mutable tags while rollback is pinned by the captured digest',()=>{
 const files=['scripts/release-tracepoint-staging.ps1','scripts/deploy-tracepoint-staging.ps1','scripts/collect-staging-release-evidence.mjs','scripts/rehearse-staging-rollback.ps1'];
 for(const file of files){
  const text=read(file);
  assert.match(text,/\[0-9a-f\]\{40\}-aws-native-staging/);
  assert.doesNotMatch(text,/ValidatePattern\('\^\[0-9a-f\]\{40\}\$'\)/);
 }
 const rollback=read('scripts/invoke-tracepoint-staging-rollback.ps1');
 assert.match(rollback,/ExpectedImageDigest/);
 assert.match(rollback,/tracepoint-staging@\(\?<digest>sha256/);
 assert.match(rollback,/does not match the pre-rollout task definition/);
 assert.doesNotMatch(rollback,/imageTag=\$tag/);
 assert.match(read('scripts/collect-staging-release-evidence.mjs'),/sourceCommit:tag\.slice\(0,40\)/);
 assert.match(tag,/^[0-9a-f]{40}-aws-native-staging$/);
 for(const invalid of ['a'.repeat(40),'latest','migration-'+tag,'A'.repeat(40)+'-aws-native-staging'])assert.doesNotMatch(invalid,/^[0-9a-f]{40}-aws-native-staging$/);
});

test('migration tags remain distinct and retain the buildspec migration exception',()=>{
 const migrations=read('scripts/apply-app-migrations.ps1');
 const buildspec=read('buildspec.staging-image.yml');
 assert.match(migrations,/\$tag = "migration-\$MigrationCommit-aws-native-\$Environment"/);
 assert.match(buildspec,/\^\(migration-\)\?\[0-9a-f\]\{40\}-aws-native-staging\$/);
 const stagingArchivePaths=migrations.slice(migrations.indexOf("if ($Environment -eq 'staging')"),migrations.indexOf("if ($Environment -eq 'production')"));
 assert.match(stagingArchivePaths,/scripts\/mobile-route-image-contract-core\.mjs/);
 assert.match(stagingArchivePaths,/scripts\/test-staging-image-mobile-routes\.sh/);
});
