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
$imageMatch = [regex]::Match($image, '^559054714699\.dkr\.ecr\.us-east-1\.amazonaws\.com/tracepoint-staging:(?<tag>[0-9a-f]{40}(?:-aws-native-staging)?)$', [Text.RegularExpressions.RegexOptions]::CultureInvariant)
if (-not $imageMatch.Success) { throw 'Rollback image must use an immutable staging commit tag.' }
$tag = $imageMatch.Groups['tag'].Value
$scan = Read-Aws @('ecr','describe-image-scan-findings','--repository-name','tracepoint-staging','--image-id',"imageTag=$tag")
Assert-TracePointImageScan -Scan $scan
$expectedImageDigest = [string]$scan.imageId.imageDigest
if ($expectedImageDigest -cnotmatch '^sha256:[0-9a-f]{64}$') { throw 'Rollback image digest is missing or invalid.' }
Write-Host "Validated rollback revision $($target.revision), commit $tag."
if (-not $Execute) { return }
Assert-TracePointStagingIdentity | Out-Null
$null = Read-Aws @('ecs','update-service','--cluster','tracepoint-staging','--service','tracepoint-staging','--task-definition',$TaskDefinitionArn)
& aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
if ($LASTEXITCODE -ne 0) { throw 'Rollback failed to stabilize.' }
function Assert-RequestedRollbackServing {
    $service = (Read-Aws @('ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging')).services[0]
    if ($service.taskDefinition -cne $TaskDefinitionArn) { throw 'Rollback stabilized on an unexpected task definition.' }
    if ([int]$service.desiredCount -ne 1 -or [int]$service.runningCount -ne 1 -or [int]$service.pendingCount -ne 0 -or @($service.deployments).Count -ne 1 -or $service.deployments[0].rolloutState -ne 'COMPLETED') { throw 'Requested rollback service is not healthy and stable.' }
    $taskArns = @( (Read-Aws @('ecs','list-tasks','--cluster','tracepoint-staging','--service-name','tracepoint-staging','--desired-status','RUNNING')).taskArns )
    if ($taskArns.Count -ne 1) { throw 'Requested rollback must have exactly one running service task.' }
    $taskResponse = Read-Aws @('ecs','describe-tasks','--cluster','tracepoint-staging','--tasks',$taskArns[0])
    if (@($taskResponse.failures).Count -ne 0 -or @($taskResponse.tasks).Count -ne 1) { throw 'Requested rollback task could not be verified.' }
    $task = $taskResponse.tasks[0]
    if ($task.lastStatus -ne 'RUNNING' -or $task.taskDefinitionArn -cne $TaskDefinitionArn) { throw 'Running task does not use the requested rollback revision.' }
    $runningContainers = @($task.containers)
    if ($runningContainers.Count -ne 1 -or $runningContainers[0].name -ne 'tracepoint' -or $runningContainers[0].image -cne $image -or $runningContainers[0].imageDigest -cne $expectedImageDigest) { throw 'Running rollback image does not match the scanned image digest.' }
}
Assert-RequestedRollbackServing
& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 600
Assert-RequestedRollbackServing
Write-Host 'Rollback stabilized. Reconcile CloudFormation to this immutable image before the next release; ECS rollback creates temporary stack drift.'
