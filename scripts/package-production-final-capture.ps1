param(
    [string] $OutputDirectory = [IO.Path]::GetTempPath()
)

$ErrorActionPreference = 'Stop'
$captureRepo = Split-Path -Parent $PSScriptRoot
$captureFiles = @(
    'package.json',
    'package-lock.json',
    'buildspec.source-production-final-capture.yml',
    'buildspec.source-production-double-compare.yml',
    'scripts/run-source-production-final-capture.mjs',
    'scripts/source-production-final-capture-core.mjs',
    'scripts/compare-frozen-source-captures.mjs',
    'scripts/source-frozen-capture-parity-core.mjs',
    'scripts/supabase-rest-ledger-core.mjs'
)

$captureDirty = & git -C $captureRepo status --porcelain -- $captureFiles
if ($LASTEXITCODE -ne 0 -or $captureDirty) {
    throw 'CAPTURE_PACKAGE_SOURCE_NOT_CLEAN'
}
$captureCommit = (& git -C $captureRepo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $captureCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'CAPTURE_PACKAGE_COMMIT_UNVERIFIED'
}
$captureOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $captureOutput -PathType Container)) {
    throw 'CAPTURE_PACKAGE_OUTPUT_DIRECTORY_MISSING'
}
$captureStage = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-final-capture-stage-' + [guid]::NewGuid().ToString('N'))
$captureStage = [IO.Path]::GetFullPath($captureStage)
$captureTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $captureStage.StartsWith($captureTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path $captureStage -Leaf).StartsWith('tracepoint-final-capture-stage-')) {
    throw 'CAPTURE_PACKAGE_STAGE_UNSAFE'
}

New-Item -ItemType Directory -Path $captureStage -ErrorAction Stop | Out-Null
try {
    foreach ($captureFile in $captureFiles) {
        $captureSource = Join-Path $captureRepo $captureFile
        if (-not (Test-Path -LiteralPath $captureSource -PathType Leaf)) {
            throw "CAPTURE_PACKAGE_FILE_MISSING:$captureFile"
        }
        $captureDestination = Join-Path $captureStage $captureFile
        $captureParent = Split-Path -Parent $captureDestination
        New-Item -ItemType Directory -Path $captureParent -Force | Out-Null
        Copy-Item -LiteralPath $captureSource -Destination $captureDestination
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $captureDraft = Join-Path $captureOutput ('tracepoint-final-capture-draft-' + [guid]::NewGuid().ToString('N') + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($captureStage, $captureDraft)
    $captureExpected = @($captureFiles | ForEach-Object { $_.Replace('\', '/') } | Sort-Object)
    $captureZip = [IO.Compression.ZipFile]::OpenRead($captureDraft)
    try {
        $captureActual = @($captureZip.Entries | ForEach-Object { $_.FullName } | Sort-Object)
        if (Compare-Object -ReferenceObject $captureExpected -DifferenceObject $captureActual) {
            throw 'CAPTURE_PACKAGE_ENTRY_MISMATCH'
        }
    } finally {
        $captureZip.Dispose()
    }

    $captureSha = (Get-FileHash -LiteralPath $captureDraft -Algorithm SHA256).Hash.ToLowerInvariant()
    $captureName = "tracepoint-production-final-capture-$captureSha.zip"
    $captureFinal = Join-Path $captureOutput $captureName
    if (Test-Path -LiteralPath $captureFinal) {
        if ((Get-FileHash -LiteralPath $captureFinal -Algorithm SHA256).Hash.ToLowerInvariant() -ne $captureSha) {
            throw 'CAPTURE_PACKAGE_EXISTING_HASH_MISMATCH'
        }
        Remove-Item -LiteralPath $captureDraft
    } else {
        Move-Item -LiteralPath $captureDraft -Destination $captureFinal
    }
    [pscustomobject]@{
        commit = $captureCommit
        archive = $captureFinal
        sourceZipKey = "source/$captureName"
        sha256 = $captureSha
        files = $captureExpected
    } | ConvertTo-Json -Depth 3
} finally {
    if (Test-Path -LiteralPath $captureStage -PathType Container) {
        Remove-Item -LiteralPath $captureStage -Recurse -Force
    }
}
