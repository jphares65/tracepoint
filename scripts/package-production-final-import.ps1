param([string] $OutputDirectory = [IO.Path]::GetTempPath())

$ErrorActionPreference = 'Stop'
$importRepo = Split-Path -Parent $PSScriptRoot
$importFiles = @(
    'package.json', 'package-lock.json',
    'Dockerfile.production-final-import', 'buildspec.production-final-import.yml',
    'scripts/supabase-rest-ledger-core.mjs',
    'scripts/supabase-rest-import-core.mjs',
    'scripts/immutable-source-artifact-validator.mjs',
    'scripts/run-supabase-rest-initial-import.mjs',
    'scripts/source-production-final-capture-core.mjs',
    'scripts/source-frozen-capture-parity-core.mjs',
    'scripts/production-final-import-core.mjs',
    'scripts/production-final-atomic-import-core.mjs',
    'scripts/production-final-relation-adapter.mjs',
    'scripts/production-final-object-archive-core.mjs',
    'scripts/production-final-object-copy-core.mjs',
    'scripts/run-production-final-atomic-import.mjs',
    'scripts/run-production-final-object-copy.mjs',
    'scripts/run-production-final-import-task.mjs',
    'scripts/run-isolated-final-import-proof.mjs'
)

$importDirty = & git -C $importRepo status --porcelain -- $importFiles
if ($LASTEXITCODE -ne 0 -or $importDirty) { throw 'FINAL_IMPORT_PACKAGE_SOURCE_NOT_CLEAN' }
$importCommit = (& git -C $importRepo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $importCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'FINAL_IMPORT_PACKAGE_COMMIT_UNVERIFIED'
}
$importOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $importOutput -PathType Container)) {
    throw 'FINAL_IMPORT_PACKAGE_OUTPUT_DIRECTORY_MISSING'
}
$importTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$importStage = Join-Path $importTempRoot ('tracepoint-final-import-stage-' + [guid]::NewGuid().ToString('N'))
if (-not $importStage.StartsWith($importTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path $importStage -Leaf).StartsWith('tracepoint-final-import-stage-')) {
    throw 'FINAL_IMPORT_PACKAGE_STAGE_UNSAFE'
}
New-Item -ItemType Directory -Path $importStage -ErrorAction Stop | Out-Null
try {
    foreach ($importFile in $importFiles) {
        $importSource = Join-Path $importRepo $importFile
        if (-not (Test-Path -LiteralPath $importSource -PathType Leaf)) {
            throw "FINAL_IMPORT_PACKAGE_FILE_MISSING:$importFile"
        }
        $importDestination = Join-Path $importStage $importFile
        New-Item -ItemType Directory -Path (Split-Path -Parent $importDestination) -Force | Out-Null
        Copy-Item -LiteralPath $importSource -Destination $importDestination
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $importDraft = Join-Path $importOutput ('tracepoint-final-import-draft-' + [guid]::NewGuid().ToString('N') + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($importStage, $importDraft)
    $importExpected = @($importFiles | ForEach-Object { $_.Replace('\', '/') } | Sort-Object)
    $importZip = [IO.Compression.ZipFile]::OpenRead($importDraft)
    try {
        $importActual = @($importZip.Entries | ForEach-Object { $_.FullName } | Sort-Object)
        if (Compare-Object -ReferenceObject $importExpected -DifferenceObject $importActual) {
            throw 'FINAL_IMPORT_PACKAGE_ENTRY_MISMATCH'
        }
    } finally { $importZip.Dispose() }
    $importSha = (Get-FileHash -LiteralPath $importDraft -Algorithm SHA256).Hash.ToLowerInvariant()
    $importFinal = Join-Path $importOutput "tracepoint-final-import-$importSha.zip"
    if (Test-Path -LiteralPath $importFinal) {
        if ((Get-FileHash -LiteralPath $importFinal -Algorithm SHA256).Hash.ToLowerInvariant() -ne $importSha) {
            throw 'FINAL_IMPORT_PACKAGE_EXISTING_HASH_MISMATCH'
        }
        Remove-Item -LiteralPath $importDraft
    } else { Move-Item -LiteralPath $importDraft -Destination $importFinal }
    [pscustomobject]@{ commit = $importCommit; archive = $importFinal;
        sourceZipKey = "source/tracepoint-final-import-$importSha.zip";
        sha256 = $importSha; files = $importExpected } | ConvertTo-Json -Depth 3
} finally {
    if (Test-Path -LiteralPath $importStage -PathType Container) {
        Remove-Item -LiteralPath $importStage -Recurse -Force
    }
}
