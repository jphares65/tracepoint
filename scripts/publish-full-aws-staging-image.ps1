[CmdletBinding()]
param(
    [switch]$ValidateArchiveOnly,
    [switch]$Wait,
    [switch]$BuildPostgresTooling,
    [ValidatePattern('^(main|codex/[a-z0-9][a-z0-9._/-]{2,159})$')]
    [string]$AuthorizedBranch = 'codex/aws-main-integration-final-20260908'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$protectedUntrackedPaths = @('scripts/seed-demo-fleet-equipment.mjs', 'src/app/integration-demo/page.tsx')
$archiveIncludes = @(
    '.dockerignore',
    'buildspec.staging-image.yml',
    'buildspec.postgres-migration.yml',
    'Dockerfile',
    'Dockerfile.postgres-migration',
    'eslint.config.mjs',
    'next.config.ts',
    'package.json',
    'package-lock.json',
    'postcss.config.mjs',
    'tsconfig.json',
    'public',
    'src',
    'database/aws',
    'supabase/migrations',
    'scripts/aws-migration-ledger.mjs',
    'scripts/bootstrap-aws-postgres-target.mjs',
    'scripts/bootstrap-aws-postgres-target-core.mjs',
    'scripts/bootstrap-aws-postgres-target-core.test.mjs',
    'scripts/database-migration-core.mjs',
    'scripts/database-migration-core.test.mjs',
    'scripts/migrate-aws-postgres-data.mjs',
    'scripts/manage-aws-native-staging-fixture.mjs',
    'scripts/postgres-bootstrap-prerequisites.mjs',
    'scripts/start-tracepoint-container.mjs',
    'scripts/validate-tracepoint-runtime-config.mjs'
)
$archiveExcludes = @(
    ':(glob,exclude)**/*.backup-*',
    ':(glob,exclude)**/*.encoding-backup-*',
    ':(glob,exclude)**/*.before-*',
    ':(glob,exclude)**/*.bak',
    ':(glob,exclude)**/*.bak-*'
)
$sourceBucket = 'tracepoint-staging-aws-native-build-source-559054714699'
$sourceKey = 'source/tracepoint-staging-aws-native-source.zip'
$projectName = 'tracepoint-staging-aws-native-image-build'

$branch = (& git.exe -C $repositoryRoot branch --show-current).Trim()
$commit = (& git.exe -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($branch -cne $AuthorizedBranch) { throw "Refusing branch '$branch'; expected the explicitly authorized '$AuthorizedBranch'." }
if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid commit SHA.' }

$status = @(& git.exe -C $repositoryRoot status --short --untracked-files=all)
$unexpected = @($status | Where-Object {
    $path = $_.Substring(3).Replace('\', '/')
    $path -notin $protectedUntrackedPaths
})
if ($unexpected.Count) { throw "Working tree contains changes outside the protected exclusions: $($unexpected -join ', ')" }

if (-not $ValidateArchiveOnly) {
    $identity = Assert-TracePointStagingIdentity
    Write-Host "Verified staging account $($identity.Account), role and region."
    $secretText = & aws.exe secretsmanager get-secret-value --secret-id tracepoint/staging/application/aws-native --query SecretString --output text --region us-east-1 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Unable to retrieve the AWS-native staging secret for validation.' }
    try {
        $secretText | & node (Join-Path $PSScriptRoot 'validate-aws-native-application-secret.mjs') staging
        if ($LASTEXITCODE -ne 0) { throw 'AWS-native staging secret failed validation; publication is blocked.' }
    }
    finally { $secretText = $null }
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("tracepoint-native-image-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryDirectory 'tracepoint-staging-aws-native-source.zip'
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
    & git.exe -C $repositoryRoot archive --format=zip --output=$archivePath $commit -- @archiveIncludes @archiveExcludes
    if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entryNames = @($archive.Entries.FullName | Where-Object { -not $_.EndsWith('/') })
        $trackedPaths = @(& git.exe -C $repositoryRoot ls-tree -r --name-only $commit)
        $untrackedEntries = @($entryNames | Where-Object { $_ -notin $trackedPaths })
        if ($untrackedEntries.Count) { throw "Archive contains untracked paths for commit ${commit}: $($untrackedEntries -join ', ')" }
        $prohibitedEntries = @($entryNames | Where-Object {
            ($_ -match '\.sql$' -and $_ -notmatch '^(database/aws|supabase/migrations)/') -or
            $_ -match '(^|/)\.env($|\.)|(^|/)\.aws/|(^|/)\.git/|(^|/)\.github/|(^|/)node_modules/|(^|/)\.next/|(^|/)cdk\.out|(^|/)dist/|\.tsbuildinfo$|(^|/)(coverage|build|out)/|\.(dump)$|(^|/)[^/]*(credential|secret)[^/]*$|\.(backup|encoding-backup)-|\.before-|\.bak($|-)'
        })
        if ($prohibitedEntries.Count) { throw "Prohibited paths entered the archive: $($prohibitedEntries -join ', ')" }
    }
    finally { $archive.Dispose() }

    Write-Host "Validated $($entryNames.Count) tracked AWS-native build-source files for commit $commit."
    if ($ValidateArchiveOnly) { return }

    Assert-TracePointStagingIdentity | Out-Null
    $sourceVersion = & aws.exe s3api put-object --bucket $sourceBucket --key $sourceKey --body $archivePath --region us-east-1 --query VersionId --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceVersion) -or $sourceVersion -eq 'None') { throw 'Versioned native source upload failed.' }
    Assert-TracePointStagingIdentity | Out-Null
    $nativeTag = "$commit-aws-native"
    $overrides = "name=IMAGE_TAG,value=$nativeTag,type=PLAINTEXT name=SOURCE_COMMIT,value=$commit,type=PLAINTEXT"
    $buildId = & aws.exe codebuild start-build --project-name $projectName --source-version $sourceVersion --environment-variables-override $overrides.Split(' ') --region us-east-1 --query build.id --output text
    if ($LASTEXITCODE -ne 0 -or $buildId -notmatch '^tracepoint-staging-aws-native-image-build:') { throw 'AWS-native CodeBuild start failed.' }
    Write-Host "Started immutable AWS-native source build $buildId."
    if ($Wait) {
        $deadline = [DateTime]::UtcNow.AddMinutes(45)
        do {
            $buildStatus = & aws.exe codebuild batch-get-builds --ids $buildId --region us-east-1 --query 'builds[0].buildStatus' --output text
            if ($LASTEXITCODE -ne 0) { throw 'Build monitoring failed.' }
            if ($buildStatus -eq 'SUCCEEDED') { break }
            if ($buildStatus -ne 'IN_PROGRESS') { throw "Build ended with $buildStatus." }
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Build monitoring timed out.' }
            Start-Sleep -Seconds 20
        } while ($true)
        $savedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & aws.exe ecr wait image-scan-complete --repository-name tracepoint-staging --image-id "imageTag=$nativeTag" --region us-east-1
            $scanExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $savedPreference }
        if ($scanExitCode -ne 0) { throw 'Image scan did not complete.' }
        Write-Host "AWS-native build and scan completed for $nativeTag."
    }
    if ($BuildPostgresTooling) {
        Assert-TracePointStagingIdentity | Out-Null
        $toolingTag = "$commit-postgres-migration"
        $toolingOverrides = "name=IMAGE_TAG,value=$toolingTag,type=PLAINTEXT name=SOURCE_COMMIT,value=$commit,type=PLAINTEXT"
        $toolingBuildId = & aws.exe codebuild start-build --project-name $projectName --source-version $sourceVersion --buildspec-override buildspec.postgres-migration.yml --environment-variables-override $toolingOverrides.Split(' ') --region us-east-1 --query build.id --output text
        if ($LASTEXITCODE -ne 0 -or $toolingBuildId -notmatch '^tracepoint-staging-aws-native-image-build:') { throw 'PostgreSQL tooling CodeBuild start failed.' }
        Write-Host "Started immutable PostgreSQL tooling build $toolingBuildId."
        if ($Wait) {
            $deadline = [DateTime]::UtcNow.AddMinutes(45)
            do {
                $toolingStatus = & aws.exe codebuild batch-get-builds --ids $toolingBuildId --region us-east-1 --query 'builds[0].buildStatus' --output text
                if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL tooling build monitoring failed.' }
                if ($toolingStatus -eq 'SUCCEEDED') { break }
                if ($toolingStatus -ne 'IN_PROGRESS') { throw "PostgreSQL tooling build ended with $toolingStatus." }
                if ([DateTime]::UtcNow -gt $deadline) { throw 'PostgreSQL tooling build timed out.' }
                Start-Sleep -Seconds 20
            } while ($true)
            & aws.exe ecr wait image-scan-complete --repository-name tracepoint-staging --image-id "imageTag=$toolingTag" --region us-east-1
            if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL tooling image scan did not complete.' }
            Write-Host "PostgreSQL tooling build and scan completed for $toolingTag."
        }
    }
}
finally {
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
    if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Force }
}
