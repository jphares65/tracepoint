Set-StrictMode -Version Latest

$script:ExpectedAccount = '559054714699'
$script:DeniedAccount = '265544358665'
$script:ExpectedRegion = 'us-east-1'
function Assert-TracePointStagingIdentity {
    if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) {
        throw 'aws.exe is required. No installation was attempted.'
    }
    $env:AWS_REGION = $script:ExpectedRegion
    $env:AWS_DEFAULT_REGION = $script:ExpectedRegion
    $identity = & aws.exe sts get-caller-identity --region $script:ExpectedRegion --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'AWS STS identity verification failed.' }
    $identity = ($identity -join [Environment]::NewLine) | ConvertFrom-Json
    if ($identity.Account -eq $script:DeniedAccount) { throw "Refusing management account $script:DeniedAccount." }
    if ($identity.Account -ne $script:ExpectedAccount) { throw "Refusing account '$($identity.Account)'." }
    if ($identity.Arn -notlike '*TracePointMigrationStaging*') { throw 'TracePointMigrationStaging role is required.' }
    if ($env:AWS_REGION -ne $script:ExpectedRegion -or $env:AWS_DEFAULT_REGION -ne $script:ExpectedRegion) {
        throw "Refusing region outside $script:ExpectedRegion."
    }
    return $identity
}

function Assert-TracePointStagingHostname {
    param([Parameter(Mandatory)][string]$Hostname)
    if ($Hostname -ne 'staging.tracepointhq.com') {
        throw "Refusing hostname '$Hostname'; expected staging.tracepointhq.com."
    }
}

function ConvertFrom-TracePointSecureString {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Assert-TracePointImageScan {
    param([Parameter(Mandatory)]$Scan)
    if ($Scan.imageScanStatus.status -ne 'COMPLETE') { throw 'Image scan must be COMPLETE.' }
    foreach ($finding in $Scan.imageScanFindings.findingSeverityCounts.PSObject.Properties) {
        if ([int]$finding.Value -ne 0) { throw "Image scan must contain zero findings at every severity." }
    }
}

function Get-TracePointStagingImageArchiveIncludes {
    return @(
        '.dockerignore', 'buildspec.staging-image.yml', 'Dockerfile', 'eslint.config.mjs',
        'next.config.ts', 'package.json', 'package-lock.json', 'postcss.config.mjs',
        'tsconfig.json', 'public', 'src', 'database/aws', 'scripts'
    )
}

function Get-TracePointStagingImageArchiveExcludes {
    return @(
        ':(glob,exclude)**/*.backup-*', ':(glob,exclude)**/*.encoding-backup-*',
        ':(glob,exclude)**/*.before-*', ':(glob,exclude)**/*.bak', ':(glob,exclude)**/*.bak-*'
    )
}

function Assert-TracePointStagingImageArchive {
    param(
        [Parameter(Mandatory)][string[]]$EntryNames,
        [Parameter(Mandatory)][string[]]$TrackedPaths
    )
    $untracked = @($EntryNames | Where-Object { $_ -notin $TrackedPaths })
    if ($untracked.Count) { throw "Staging image archive contains untracked paths: $($untracked -join ', ')" }

    $requiredFiles = @(
        '.dockerignore', 'buildspec.staging-image.yml', 'Dockerfile', 'eslint.config.mjs',
        'next.config.ts', 'package.json', 'package-lock.json', 'postcss.config.mjs',
        'tsconfig.json', 'scripts/run-application-tests.mjs', 'scripts/aws-native-migrations.test.mjs',
        'scripts/start-tracepoint-container.mjs', 'scripts/validate-tracepoint-runtime-config.mjs'
    )
    $missing = @($requiredFiles | Where-Object { $_ -notin $EntryNames })
    foreach ($prefix in @('public/', 'src/', 'database/aws/', 'scripts/')) {
        if (-not ($EntryNames | Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) })) { $missing += $prefix }
    }
    if ($missing.Count) { throw "Staging image archive omits required Docker or CodeBuild inputs: $($missing -join ', ')" }

    $prohibitedEntries = @($EntryNames | Where-Object {
        $sourceCodeFile = $_ -match '\.(?:[cm]?[jt]sx?|ps1|psm1|psd1)$'
        $credentialNamedFile = $_ -match '(^|/)[^/]*(credential|secret)[^/]*$'
        $badPath = $_ -match '(^|/)\.env($|\.)|(^|/)\.aws/|(^|/)\.git/|(^|/)\.github/|(^|/)node_modules/|(^|/)\.next/|(^|/)cdk\.out|(^|/)dist/|\.tsbuildinfo$|(^|/)(coverage|build|out)/|\.dump$|\.(?:key|p12|pfx|jks)$|\.(backup|encoding-backup)-|\.before-|\.bak($|-)'
        $sourceSql = $_ -match '^scripts/(?:fixtures/migration-lineages/.+|validate-local-[^/]+)\.sql$'
        $nonMigrationSql = $_.EndsWith('.sql') -and $_ -notmatch '^database/aws/[^/]+\.sql$' -and -not $sourceSql
        $sensitiveNamedData = $credentialNamedFile -and -not $sourceCodeFile
        $badPath -or $nonMigrationSql -or $sensitiveNamedData
    })
    if ($prohibitedEntries.Count) { throw "Staging image archive contains prohibited secret, credential, environment, dump, or generated paths: $($prohibitedEntries -join ', ')" }
}

Export-ModuleMember -Function Assert-TracePointImageScan, Assert-TracePointStagingIdentity, Assert-TracePointStagingHostname, ConvertFrom-TracePointSecureString, Get-TracePointStagingImageArchiveIncludes, Get-TracePointStagingImageArchiveExcludes, Assert-TracePointStagingImageArchive
