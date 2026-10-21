[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][ValidateSet('staging','production')][string]$Environment,
    [ValidateSet('status','baseline','apply','diagnose')][string]$Action = 'status',
    [ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ExpectedImageDigest,
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ImageCommit
)

# Database-release wrapper.  Database credentials remain injected by ECS from
# the existing runtime secret; this workstation neither reads nor constructs a
# PostgreSQL connection string.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'migration-release-core.psm1') -Force

$settings = @{
    staging = @{ Account='559054714699'; Profile='tracepoint-member-staging'; Role='TracePointMigrationStaging'; Region='us-east-1'; Repository='tracepoint-staging' }
    production = @{ Account='193644343389'; Profile='tracepoint-production'; Role='TracePointMigrationProduction'; Region='us-east-1'; Repository='tracepoint-production' }
}[$Environment]
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$migrationFiles = @(Get-AwsMigrationFiles -Directory (Join-Path $root 'database/aws'))
. (Join-Path $PSScriptRoot 'deploy-app-rollout-core.ps1')

function Invoke-Aws([string[]]$Arguments) {
    $prior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & aws.exe @Arguments --profile $settings.Profile --region $settings.Region --output json 2>&1; $exitCode = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prior }
    if ($exitCode -ne 0) { throw "AWS command failed: aws $($Arguments -join ' ')" }
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}
function Assert-Identity {
    if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw 'aws.exe is required; this script will not install it.' }
    $identity = Invoke-Aws @('sts','get-caller-identity')
    if ($Environment -eq 'staging') { Assert-StagingIdentity -Identity $identity | Out-Null; return }
    if ($identity.Account -ne $settings.Account -or $identity.Arn -notmatch "^arn:aws:sts::$($settings.Account):assumed-role/[^/]*$($settings.Role)[^/]*/[^/]+$") { throw 'AWS identity does not match the requested environment.' }
}
function Get-ReviewedCommit {
    $commit = (& git.exe -C $root rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Unable to resolve the reviewed HEAD commit.' }
    $status = @(& git.exe -C $root status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the database release working tree.' }
    if ($status.Count -ne 0) { throw 'Database release requires a clean reviewed commit.' }
    return $commit
}
function Resolve-ApplicationCommit([string]$ToolingCommit) {
    if (-not $ImageCommit) { return $ToolingCommit }
    $resolved = (& git.exe -C $root rev-parse "$ImageCommit^{commit}").Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $resolved -cne $ImageCommit) { throw 'Requested application image commit is not an exact local commit.' }
    & git.exe -C $root merge-base --is-ancestor $resolved $ToolingCommit
    if ($LASTEXITCODE -ne 0) { throw 'Requested application commit must be an ancestor of the reviewed release tooling commit.' }
    return $resolved
}
function Assert-ApplicationImage([string]$Commit) {
    $tag = Get-ApplicationImageTag -Environment $Environment -Commit $Commit
    Assert-ReviewedImageTag -Environment $Environment -Commit $Commit -Tag $tag | Out-Null
    $image = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1
    if ($null -eq $image -or [string]::IsNullOrWhiteSpace([string]$image.imageDigest)) { throw 'The reviewed application image is not present in the target ECR repository. Build and publish the exact reviewed commit first.' }
    if (@($image.imageTags) -cnotcontains $tag) { throw 'ECR did not attest the exact reviewed image tag.' }
    $scan = Invoke-Aws @('ecr','describe-image-scan-findings','--repository-name',$settings.Repository,'--image-id',"imageDigest=$($image.imageDigest)")
    if (-not (Test-CleanImageScan $scan)) { throw 'The reviewed application image scan is not clean.' }
    return $image.imageDigest
}

if ($Action -eq 'baseline' -and $Environment -ne 'staging') { throw 'Baseline is staging-only.' }
if ($Action -eq 'diagnose' -and $Environment -ne 'staging') { throw 'Database diagnostics are staging-only.' }
if ($Action -eq 'diagnose' -and $ImageCommit -cne 'a3fa9855f4c797dfb7b4dd16144cf6c85a445946') { throw 'Migration 038 diagnostics require the already-built application commit a3fa9855f4c797dfb7b4dd16144cf6c85a445946.' }
if ($Action -eq 'apply' -and $Environment -eq 'production') { throw 'Production migration application requires separately authorized production release execution; this command permits production status only.' }

Assert-Identity
$toolingCommit = Get-ReviewedCommit
$commit = Resolve-ApplicationCommit $toolingCommit
$digest = Assert-ApplicationImage $commit
if ($ExpectedImageDigest) { Assert-ImageDigest -Actual $digest -Expected $ExpectedImageDigest | Out-Null }
$migrationOutput = @(& (Join-Path $PSScriptRoot 'apply-app-migrations.ps1') -Environment $Environment -Action $Action -ImageCommit $commit -MigrationSourceCommit $toolingCommit -ApplicationImageDigest $digest)
if ($LASTEXITCODE -ne 0) { throw 'Ledgered ECS migration task failed.' }
$digestAfter = Assert-ApplicationImage $commit
Assert-ImageDigest -Actual $digestAfter -Expected $digest | Out-Null
if ($Action -in @('status','apply')) {
    $report = @($migrationOutput | Where-Object { $null -ne $_.PSObject.Properties['ledger'] } | Select-Object -Last 1)
    if ($report.Count -ne 1) { throw 'Migration runner ledger report was not returned to the release wrapper.' }
    $expectation = if ($Action -eq 'apply') { 'after-apply' } else { 'status' }
    Assert-MigrationLedgerReport -Report $report[0] -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation $expectation | Out-Null
    $report[0] | Add-Member -NotePropertyName application_commit -NotePropertyValue $commit -Force
    $report[0] | Add-Member -NotePropertyName application_image_tag -NotePropertyValue (Get-ReviewedImageTag -Environment $Environment -Commit $commit) -Force
    $report[0] | Add-Member -NotePropertyName application_image_digest -NotePropertyValue $digest -Force
    Write-Host "MIGRATION $($Action.ToUpperInvariant()) VERIFIED: $Environment application commit $commit, tooling commit $toolingCommit, image $digest, applied $(@($report[0].applied).Count), pending $(@($report[0].pending).Count)."
    $report[0]
} else {
    Write-Host "MIGRATION $($Action.ToUpperInvariant()) SUCCEEDED: $Environment application commit $commit, verified image $digest."
    $migrationOutput
}
