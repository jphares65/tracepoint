[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$CurrentImageTag,
 [Parameter(Mandatory)][ValidatePattern('^arn:aws:ecs:us-east-1:559054714699:task-definition/[^:]+:[0-9]+$')][string]$PriorTaskDefinitionArn,
 [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
function Read-Aws([string[]]$Arguments) {
 $raw=& aws.exe @Arguments --region us-east-1 --output json
 if($LASTEXITCODE -ne 0){throw 'Rollback rehearsal AWS operation failed.'}
 return ($raw -join "`n") | ConvertFrom-Json
}
$service=(Read-Aws @('ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging')).services[0]
$currentArn=$service.taskDefinition
$current=(Read-Aws @('ecs','describe-task-definition','--task-definition',$currentArn)).taskDefinition
if($current.status -ne 'ACTIVE' -or $current.containerDefinitions.Count -ne 1 -or $current.containerDefinitions[0].image -ne "559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:$CurrentImageTag"){throw 'Current rollback baseline image mismatch.'}
& node (Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs') --image $CurrentImageTag
if($LASTEXITCODE -ne 0){throw 'Current baseline evidence failed; no rollback performed.'}
& (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $PriorTaskDefinitionArn
if(-not $Execute){Write-Host 'Rehearsal preconditions validated; use -Execute for the controlled rollback and return.';return}
$rollbackSeconds=$null;$returnSeconds=$null;$rollbackVerified=$false
try {
 $timer=[Diagnostics.Stopwatch]::StartNew()
 & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $PriorTaskDefinitionArn -Execute
 $timer.Stop();$rollbackSeconds=$timer.Elapsed.TotalSeconds;$rollbackVerified=$true
} finally {
 # CloudFormation already describes this current revision. A no-op CDK deploy
 # would not repair temporary ECS drift, so restore the captured exact ARN.
 Assert-TracePointStagingIdentity | Out-Null
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $null=Read-Aws @('ecs','update-service','--cluster','tracepoint-staging','--service','tracepoint-staging','--task-definition',$currentArn)
 & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
 if($LASTEXITCODE -ne 0){throw 'Return to corrected runtime did not stabilize.'}
 & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
 & node (Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs') --image $CurrentImageTag
 if($LASTEXITCODE -ne 0){throw 'Corrected runtime evidence failed after rehearsal.'}
 $timer.Stop();$returnSeconds=$timer.Elapsed.TotalSeconds
 [ordered]@{currentTaskDefinition=$currentArn;priorTaskDefinition=$PriorTaskDefinitionArn;imageTag=$CurrentImageTag;rollbackVerified=$rollbackVerified;rollbackSeconds=$rollbackSeconds;returnSeconds=$returnSeconds;correctedRuntimeRestored=$true}|ConvertTo-Json
}
