[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^arn:aws:ecs:us-east-1:559054714699:task-definition/[^:]+:[0-9]+$')][string]$TaskDefinitionArn,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
function Read-Aws([string[]]$Arguments) {
    $raw = & aws.exe @Arguments --region us-east-1 --output json
    if ($LASTEXITCODE -ne 0) { throw 'Rollback metadata query failed.' }
    return ($raw -join "`n") | ConvertFrom-Json
}
$service = (Read-Aws @('ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging')).services[0]
$current = (Read-Aws @('ecs','describe-task-definition','--task-definition',$service.taskDefinition)).taskDefinition
$target = (Read-Aws @('ecs','describe-task-definition','--task-definition',$TaskDefinitionArn)).taskDefinition
if ($target.family -ne $current.family -or $target.revision -ge $current.revision -or $target.status -ne 'ACTIVE') { throw 'Rollback requires an older ACTIVE revision of the same task family.' }
$containers = @($target.containerDefinitions)
if ($containers.Count -ne 1 -or $containers[0].name -ne 'tracepoint') { throw 'Unexpected rollback container definition.' }
$image = [string]$containers[0].image
if ($image -notmatch '^559054714699\.dkr\.ecr\.us-east-1\.amazonaws\.com/tracepoint-staging:(?<tag>[0-9a-f]{40})$') { throw 'Rollback image must be an immutable staging commit tag.' }
$tag = $Matches.tag
$scan = Read-Aws @('ecr','describe-image-scan-findings','--repository-name','tracepoint-staging','--image-id',"imageTag=$tag")
    Assert-TracePointImageScan -Scan $scan
Write-Host "Validated rollback revision $($target.revision), commit $tag."
if (-not $Execute) { return }
Assert-TracePointStagingIdentity | Out-Null
$null = Read-Aws @('ecs','update-service','--cluster','tracepoint-staging','--service','tracepoint-staging','--task-definition',$TaskDefinitionArn)
& aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
if ($LASTEXITCODE -ne 0) { throw 'Rollback failed to stabilize.' }
& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 600
Write-Host 'Rollback stabilized. Reconcile CloudFormation to this immutable image before the next release; ECS rollback creates temporary stack drift.'
