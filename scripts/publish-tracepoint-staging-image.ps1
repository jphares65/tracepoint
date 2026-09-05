[CmdletBinding()]
param([switch]$ValidateArchiveOnly, [switch]$Wait)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$protectedUntrackedPaths = @('scripts/seed-demo-fleet-equipment.mjs', 'src/app/integration-demo/page.tsx')
$archiveIncludes = @(
    '.dockerignore',
    'buildspec.staging-image.yml',
    'Dockerfile',
    'eslint.config.mjs',
    'next.config.ts',
    'package.json',
    'package-lock.json',
    'postcss.config.mjs',
    'tsconfig.json',
    'public',
    'src',
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
$sourceBucket = 'tracepoint-staging-build-source-559054714699'
$sourceKey = 'source/tracepoint-staging-source.zip'
$projectName = 'tracepoint-staging-image-build'

$branch = (& git.exe -C $repositoryRoot branch --show-current).Trim()
$commit = (& git.exe -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($branch -ne 'codex/aws-staging-readiness-20260902') { throw "Refusing branch '$branch'." }
if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid commit SHA.' }

$status = @(& git.exe -C $repositoryRoot status --short --untracked-files=all)
$unexpected = @($status | Where-Object {
    $path = $_.Substring(3).Replace('\', '/')
    $path -notin $protectedUntrackedPaths
})
if ($unexpected.Count) { throw "Working tree contains changes outside the protected exclusions: $($unexpected -join ', ')" }

if (-not $ValidateArchiveOnly) {
    $identity = Assert-TracePointStagingIdentity
    Write-Host "Verified account $($identity.Account), role TracePointMigrationStaging, region us-east-1."

    $secretText = & aws.exe secretsmanager get-secret-value --secret-id tracepoint/staging/application --query SecretString --output text --region us-east-1
    if ($LASTEXITCODE -ne 0) { throw 'Unable to validate staging configuration names.' }
    try {
        $secret = $secretText | ConvertFrom-Json
        if ($secret.NEXT_PUBLIC_SUPABASE_URL -ne 'https://wztqqqashilusoppddxi.supabase.co') { throw 'Only the isolated staging Supabase project is allowed.' }
        $required = @(
            'NEXT_PUBLIC_SUPABASE_URL',
            'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
            'NEXT_PUBLIC_SITE_URL',
            'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
            'CONFIGURATION_ENVIRONMENT'
        )
        $missing = @($required | Where-Object {
            $property = $secret.PSObject.Properties[$_]
            $null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)
        })
        if ($missing.Count) { throw "Staging secret is missing required names: $($missing -join ', ')" }
        if ([string]$secret.CONFIGURATION_ENVIRONMENT -ne 'staging') { throw 'CONFIGURATION_ENVIRONMENT must equal staging.' }
        if ([string]$secret.NEXT_PUBLIC_SITE_URL -ne 'https://staging.tracepointhq.com') { throw 'NEXT_PUBLIC_SITE_URL must identify the staging hostname.' }
        $secret | ConvertTo-Json -Compress | & node (Join-Path $PSScriptRoot 'validate-staging-provider-config.mjs') --supabase-only
        if ($LASTEXITCODE -ne 0) { throw 'Staging provider credentials failed validation; no publication or deployment is permitted.' }
    }
    finally {
        $secretText = $null
        $secret = $null
    }
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("tracepoint-image-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryDirectory 'tracepoint-staging-source.zip'
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
    & git.exe -C $repositoryRoot archive --format=zip --output=$archivePath $commit -- @archiveIncludes @archiveExcludes
    if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
    $archiveEntries = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entryNames = @($archiveEntries.Entries.FullName | Where-Object { -not $_.EndsWith('/') })
        $trackedPaths = @(& git.exe -C $repositoryRoot ls-tree -r --name-only $commit)
        $untrackedEntries = @($entryNames | Where-Object { $_ -notin $trackedPaths })
        if ($untrackedEntries.Count) {
            throw "Archive contains paths not tracked by commit ${commit}: $($untrackedEntries -join ', ')"
        }
        $prohibitedEntries = @($entryNames | Where-Object {
            $_ -match '(^|/)\.env($|\.)|(^|/)\.aws/|(^|/)\.git/|(^|/)\.github/|(^|/)node_modules/|(^|/)\.next/|(^|/)cdk\.out|(^|/)dist/|\.tsbuildinfo$|(^|/)(coverage|build|out)/|\.(dump|sql)$|(^|/)[^/]*(credential|secret)[^/]*$|\.(backup|encoding-backup)-|\.before-|\.bak($|-)'
        })
        if ($prohibitedEntries.Count) {
            throw "Prohibited secret, environment, credential, dump, or generated paths entered the archive: $($prohibitedEntries -join ', ')"
        }
    }
    finally { $archiveEntries.Dispose() }

    Write-Host "Validated $($entryNames.Count) tracked build-source files for commit $commit."
    if ($ValidateArchiveOnly) { return }

    Assert-TracePointStagingIdentity | Out-Null
    $sourceVersion = & aws.exe s3api put-object --bucket $sourceBucket --key $sourceKey --body $archivePath --region us-east-1 --query VersionId --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceVersion) -or $sourceVersion -eq 'None') { throw 'Versioned source upload failed.' }
    Assert-TracePointStagingIdentity | Out-Null
    $overrides = "name=IMAGE_TAG,value=$commit,type=PLAINTEXT name=SOURCE_COMMIT,value=$commit,type=PLAINTEXT"
    $buildId = & aws.exe codebuild start-build --project-name $projectName --source-version $sourceVersion --environment-variables-override $overrides.Split(' ') --region us-east-1 --query build.id --output text
    if ($LASTEXITCODE -ne 0) { throw 'CodeBuild start failed.' }
    Write-Host "Started immutable source build $buildId."
    if ($Wait) {
        $deadline = [DateTime]::UtcNow.AddMinutes(45)
        do {
            $status = & aws.exe codebuild batch-get-builds --ids $buildId --region us-east-1 --query 'builds[0].buildStatus' --output text
            if ($LASTEXITCODE -ne 0) { throw 'Build monitoring failed.' }
            if ($status -eq 'SUCCEEDED') { break }
            if ($status -ne 'IN_PROGRESS') { throw "Build ended with $status." }
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Build monitoring timed out.' }
            Start-Sleep -Seconds 20
        } while ($true)
        # PowerShell 5 treats native CLI stderr as ErrorRecord even on success.
        # Retain the native exit-code gate; never infer scan completion from stderr.
        $scanErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & aws.exe ecr wait image-scan-complete --repository-name tracepoint-staging --image-id "imageTag=$commit" --region us-east-1
            $scanExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $scanErrorPreference }
        if ($scanExitCode -ne 0) { throw 'Image scan did not complete.' }
        Write-Host "Build and scan completed for $commit; deployment separately rejects HIGH/CRITICAL findings."
    }
}
finally {
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
    if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Force }
}
