[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ImageTag,
    [Parameter(Mandatory)][string]$CertificateArn
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
foreach ($name in @('TRACEPOINT_ACCEPTANCE_EMAIL','TRACEPOINT_ACCEPTANCE_PASSWORD','TRACEPOINT_ACCEPTANCE_DEPARTMENT_ID')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "Authenticated release smoke requires $name before deployment." }
}
Assert-TracePointStagingIdentity | Out-Null
$previous = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
if ($LASTEXITCODE -ne 0 -or $previous -notmatch '^arn:aws:ecs:us-east-1:559054714699:task-definition/') { throw 'A previous task revision is required for automatic rollback.' }
& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')
try {
    & (Join-Path $PSScriptRoot 'deploy-tracepoint-staging.ps1') -Action DeployRuntime -ImageTag $ImageTag -CertificateArn $CertificateArn
    & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
    if ($LASTEXITCODE -ne 0) { throw 'ECS failed to stabilize.' }
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')
    & node (Join-Path $PSScriptRoot 'test-staging-acceptance.mjs') --smoke
    if ($LASTEXITCODE -ne 0) { throw 'Acceptance is incomplete or failed; release is not accepted.' }
} catch {
    $failure = $_
    $current = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
    if ($LASTEXITCODE -ne 0) { throw 'Release failed and current revision cannot be verified. Manual staging recovery is required.' }
    if ($current -ne $previous) { & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $previous -Execute }
    throw $failure
}
