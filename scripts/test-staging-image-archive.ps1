Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 does not load the zip types by default (the publisher loads them the same way).
Add-Type -AssemblyName System.IO.Compression.FileSystem
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$commit = (& git.exe -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Unable to resolve the intended staging archive commit.' }
$paths = @(Get-TracePointStagingImageArchiveIncludes)
$excludes = @(Get-TracePointStagingImageArchiveExcludes)
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-staging-archive-test-' + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryRoot 'source.zip'
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
    & git.exe -C $repositoryRoot archive --format=zip "--output=$archivePath" $commit -- @paths @excludes
    if ($LASTEXITCODE -ne 0) { throw 'git archive could not create the intended local source archive.' }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') } | ForEach-Object FullName)
    } finally { $archive.Dispose() }
    $tracked = @(& git.exe -C $repositoryRoot ls-tree -r --name-only $commit)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to enumerate tracked paths for archive validation.' }
    Assert-TracePointStagingImageArchive -EntryNames $entries -TrackedPaths $tracked

    $safeSource = 'scripts/create-dedicated-supabase-rest-secret.mjs'
    Assert-TracePointStagingImageArchive -EntryNames (@($entries) + $safeSource) -TrackedPaths (@($tracked) + $safeSource)

    foreach ($fixture in @('.env.production', 'config/credential-secret.json', 'scripts/credential-secret.json', 'database/other/unsafe.sql')) {
        $rejected = $false
        try { Assert-TracePointStagingImageArchive -EntryNames (@($entries) + $fixture) -TrackedPaths (@($tracked) + $fixture) }
        catch { $rejected = $true }
        if (-not $rejected) { throw "Archive validator accepted sensitive or non-migration fixture '$fixture'." }
    }
    Write-Host "Validated real git archive for $commit, required Docker/CodeBuild inputs, safe secret-named source, and four rejected fixtures. Zero AWS calls."
} finally {
    $resolved = [IO.Path]::GetFullPath($temporaryRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne $tempRoot -or [IO.Path]::GetFileName($resolved) -notlike 'tracepoint-staging-archive-test-*') { throw 'Temporary archive cleanup boundary failed.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
