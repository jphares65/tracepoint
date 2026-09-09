[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$commit=(& git.exe -C $root rev-parse HEAD).Trim()
if($commit -notmatch '^[0-9a-f]{40}$' -or (& git.exe -C $root branch --show-current).Trim() -ne 'codex/aws-staging-readiness-20260902'){throw 'Reviewed AWS branch required'}
if(@(& git.exe -C $root status --porcelain).Count){throw 'Commit reviewed work before publication'}
$archive=Join-Path ([IO.Path]::GetTempPath()) ('tp-postgres-source-'+[guid]::NewGuid().ToString('N')+'.zip')
try {
 & git.exe -C $root archive --format=zip --output=$archive $commit -- Dockerfile.postgres-rehearsal Dockerfile.postgres-rehearsal.dockerignore buildspec.postgres-rehearsal.yml package.json package-lock.json scripts/run-aws-postgres-rehearsal.mjs scripts/run-aws-postgres-rehearsal.test.mjs scripts/postgres-bootstrap-prerequisites.mjs scripts/staging-management-manifest.mjs scripts/validate-local-tenant-isolation.sql scripts/validate-local-armory-workflows.sql supabase/migrations
 if($LASTEXITCODE -ne 0){throw 'Source archive failed'}
 Assert-TracePointStagingIdentity | Out-Null
 $version=& aws.exe s3api put-object --bucket tracepoint-staging-build-source-559054714699 --key source/tracepoint-staging-source.zip --body $archive --region us-east-1 --query VersionId --output text
 if($LASTEXITCODE -ne 0 -or $version -eq 'None'){throw 'Immutable source version required'}
 Assert-TracePointStagingIdentity | Out-Null
 $tag=$commit+'-postgres-rehearsal'
 $build=& aws.exe codebuild start-build --project-name tracepoint-staging-image-build --source-version $version --buildspec-override buildspec.postgres-rehearsal.yml --environment-variables-override "name=IMAGE_TAG,value=$tag,type=PLAINTEXT" "name=SOURCE_COMMIT,value=$commit,type=PLAINTEXT" --region us-east-1 --query build.id --output text
 if($LASTEXITCODE -ne 0){throw 'Rehearsal build failed to start'}
 [pscustomobject]@{buildId=$build;imageTag=$tag;sourceCommit=$commit}|ConvertTo-Json -Compress
}finally{if(Test-Path -LiteralPath $archive){Remove-Item -LiteralPath $archive -Force}}
