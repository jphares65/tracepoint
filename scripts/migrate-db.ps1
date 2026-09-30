[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][ValidateSet('staging','production')][string]$Environment,
    [ValidateSet('status','baseline','apply')][string]$Action = 'status'
)

# Database-release wrapper.  Database credentials remain injected by ECS from
# the existing runtime secret; this workstation neither reads nor constructs a
# PostgreSQL connection string.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$settings = @{
    staging = @{ Account='559054714699'; Profile='tracepoint-member-staging'; Role='TracePointMigrationStaging'; Region='us-east-1'; Repository='tracepoint-staging' }
    production = @{ Account='193644343389'; Profile='tracepoint-production'; Role='TracePointMigrationProduction'; Region='us-east-1'; Repository='tracepoint-production' }
}[$Environment]
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

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
    if ($identity.Account -ne $settings.Account -or $identity.Arn -notmatch "^arn:aws:sts::$($settings.Account):assumed-role/[^/]*$($settings.Role)[^/]*/[^/]+$") { throw 'AWS identity does not match the requested environment.' }
}
function Get-ReviewedCommit {
    $commit = (& git.exe -C $root rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Unable to resolve the reviewed HEAD commit.' }
    if (@(& git.exe -C $root status --porcelain --untracked-files=all).Count -ne 0) { throw 'Database release requires a clean reviewed commit.' }
    return $commit
}
function Assert-ApplicationImage([string]$Commit) {
    $tag = if ($Environment -eq 'production') { "$Commit-aws-native-production" } else { $Commit }
    $image = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1
    if ($null -eq $image -or [string]::IsNullOrWhiteSpace([string]$image.imageDigest)) { throw 'The reviewed application image is not present in the target ECR repository. Deploy the final application image first.' }
    $scan = Invoke-Aws @('ecr','describe-image-scan-findings','--repository-name',$settings.Repository,'--image-id',"imageDigest=$($image.imageDigest)")
    if ($scan.imageScanStatus.status -ne 'COMPLETE' -or @($scan.imageScanFindings.findingSeverityCounts.PSObject.Properties | Where-Object { [int]$_.Value -ne 0 }).Count -ne 0) { throw 'The reviewed application image scan is not clean.' }
    return $image.imageDigest
}

if ($Action -eq 'baseline' -and $Environment -ne 'staging') { throw 'Baseline is staging-only.' }
if ($Action -eq 'apply' -and $Environment -eq 'production') { throw 'Production migration application requires separately authorized production release execution; this command permits production status only.' }

Assert-Identity
$commit = Get-ReviewedCommit
$digest = Assert-ApplicationImage $commit
& (Join-Path $PSScriptRoot 'apply-app-migrations.ps1') -Environment $Environment -Action $Action -ImageCommit $commit
if ($LASTEXITCODE -ne 0) { throw 'Ledgered ECS migration task failed.' }
Write-Host "MIGRATION $($Action.ToUpperInvariant()) SUCCEEDED: $Environment application commit $commit, verified image $digest."
