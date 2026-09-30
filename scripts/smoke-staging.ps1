[CmdletBinding()]
param()

# Full Golden Path acceptance uses generated tenant/user identifiers and the
# existing parent harness verifies their cleanup before it exits successfully.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (@(& git.exe -C $root status --porcelain --untracked-files=all).Count -ne 0) { throw 'Golden Path evidence requires a clean reviewed checkout.' }
$identity = & aws.exe sts get-caller-identity --profile tracepoint-member-staging --region us-east-1 --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne '559054714699' -or $identity.Arn -notmatch '^arn:aws:sts::559054714699:assumed-role/[^/]*TracePointMigrationStaging[^/]*/') { throw 'Golden Path requires the staging TracePointMigrationStaging AWS identity.' }
$savedProfile = $env:AWS_PROFILE
$savedRegion = $env:AWS_REGION
$savedDefaultRegion = $env:AWS_DEFAULT_REGION
$savedLoadConfig = $env:AWS_SDK_LOAD_CONFIG
$env:AWS_PROFILE = 'tracepoint-member-staging'
$env:AWS_REGION = 'us-east-1'
$env:AWS_DEFAULT_REGION = 'us-east-1'
$env:AWS_SDK_LOAD_CONFIG = '1'
$prior = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & node.exe --import tsx (Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs') --execute --range-documents --extended-workflows
    $exitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prior
    $env:AWS_PROFILE = $savedProfile
    $env:AWS_REGION = $savedRegion
    $env:AWS_DEFAULT_REGION = $savedDefaultRegion
    $env:AWS_SDK_LOAD_CONFIG = $savedLoadConfig
}
if ($exitCode -ne 0) { throw 'GOLDEN PATH FAIL: the disposable staging harness reported a failure after attempting cleanup.' }
foreach ($workflow in @('authentication and session','dashboard and API','firearms','equipment','fleet','range and training','settings')) { Write-Host "GOLDEN PATH PASS: $workflow" }
Write-Host 'GOLDEN PATH PASS: synthetic fixture cleanup verified'
