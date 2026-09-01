[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('tracepoint-staging-runtime')][string]$StackName,
    [Parameter(Mandatory)][string]$ConfirmedStackName,
    [switch]$Execute,
    [string]$Profile = 'tracepoint-member-staging'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity -Profile $Profile | Out-Null
if ($ConfirmedStackName -cne $StackName) { throw 'ConfirmedStackName must exactly match the staging runtime stack.' }

Write-Host 'Rollback runbook: identify the last healthy immutable image, review a runtime-only CDK diff, and redeploy through the guarded staging orchestration workflow.'
Write-Host 'Never delete the stack, secret, repository, log group, KMS key, or foundation stacks.'
if (-not $Execute) {
    Write-Host 'Dry run only. No AWS state was changed.'
    return
}
throw 'Automated rollback is intentionally unavailable until the orchestration script accepts and verifies an explicit prior immutable image digest.'
