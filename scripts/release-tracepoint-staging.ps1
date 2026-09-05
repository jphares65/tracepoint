[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ImageTag,
    [Parameter(Mandatory)][string]$CertificateArn,
    [ValidateSet('s3')][string]$StorageProvider = 's3'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
# Use disposable staging fixtures instead of stored acceptance passwords.
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Assert-TracePointStagingIdentity | Out-Null
& node --import tsx (Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs') --execute --fixtures-only
if ($LASTEXITCODE -ne 0) { throw 'Disposable staging authentication preflight failed.' }
$previous = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
if ($LASTEXITCODE -ne 0 -or $previous -notmatch '^arn:aws:ecs:us-east-1:559054714699:task-definition/') { throw 'A previous task revision is required for automatic rollback.' }
& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')
try {
    & (Join-Path $PSScriptRoot 'deploy-tracepoint-staging.ps1') -Action DeployRuntime -ImageTag $ImageTag -CertificateArn $CertificateArn -StorageProvider $StorageProvider
    & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
    if ($LASTEXITCODE -ne 0) { throw 'ECS failed to stabilize.' }
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
    & node --import tsx (Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs') --execute --range-documents --extended-workflows
    if ($LASTEXITCODE -ne 0) { throw 'Implemented acceptance scenarios failed; release is not accepted.' }
    & node (Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs') --image $ImageTag
    if ($LASTEXITCODE -ne 0) { throw 'Release image, alarms, logs or public gates failed.' }
} catch {
    $failure = $_
    $current = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
    if ($LASTEXITCODE -ne 0) { throw 'Release failed and current revision cannot be verified. Manual staging recovery is required.' }
    if ($current -ne $previous) { & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $previous -Execute }
    throw $failure
}
