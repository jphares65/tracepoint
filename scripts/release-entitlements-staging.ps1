[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ToolingCommit,
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ApplicationCommit = '353933a6b98ad7e6c3ac082b786c6a8c7b7aedb8',
    [ValidateRange(5,60)][int]$MaximumPitrAgeMinutes = 30
)

# Controlled, migration-first AWS-native staging release. The image publisher,
# migration runner, and application deployer each retain their own account gates.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$region = 'us-east-1'
$account = '559054714699'
$profile = 'tracepoint-member-staging'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$oldAwsProfile = $env:AWS_PROFILE
$oldAwsRegion = $env:AWS_REGION
$oldAwsDefaultRegion = $env:AWS_DEFAULT_REGION
$env:AWS_PROFILE = $profile
$env:AWS_REGION = $region
$env:AWS_DEFAULT_REGION = $region
Import-Module (Join-Path $PSScriptRoot 'migration-release-core.psm1') -Force

function Invoke-NativeChecked {
    param([Parameter(Mandatory)][string]$File,[Parameter(Mandatory)][string[]]$Arguments)
    $output = & $File @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $exitCode. $($output -join ' ')" }
    return $output
}
function Invoke-AwsRead {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = Invoke-NativeChecked -File 'aws.exe' -Arguments ($Arguments + @('--profile',$profile,'--region',$region,'--output','json'))
    try { return ($output -join [Environment]::NewLine) | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "AWS returned invalid JSON for '$($Arguments -join ' ')'." }
}
function Invoke-ReleaseScript {
    param(
        [Parameter(Mandatory, Position=0)][string]$Path,
        [Parameter(Mandatory, Position=1)][string[]]$ScriptArguments
    )
    try {
        $result = @(& $Path @ScriptArguments)
        if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) {
            throw "Nested script exited with code $LASTEXITCODE"
        }
        return $result
    }
    catch { throw "$Path failed: $($_.Exception.Message)" }
}
function Get-VerifiedLedgerReport {
    param([Parameter(Mandatory)][object[]]$Output,[Parameter(Mandatory)][ValidateSet('before-apply','after-apply','status')][string]$Expectation,[Parameter(Mandatory)][string]$ExpectedDigest)
    $reports = @($Output | Where-Object { $null -ne $_.PSObject.Properties['ledger'] })
    if ($reports.Count -ne 1) { throw "Expected one validated migration report; received $($reports.Count)." }
    $files = @(Get-ChildItem (Join-Path $repositoryRoot 'database/aws') -File | Where-Object { $_.Name -match '^[0-9]{3}_[a-z0-9_]+\.sql$' } | Sort-Object Name | ForEach-Object FullName)
    Assert-MigrationLedgerReport -Report $reports[0] -MigrationFiles $files -Expectation $Expectation | Out-Null
    Assert-ImageDigest -Actual $reports[0].application_image_digest -Expected $ExpectedDigest | Out-Null
    if ($reports[0].application_commit -cne $ApplicationCommit) { throw 'Migration report does not refer to the reviewed application commit.' }
    return $reports[0]
}
function Assert-RdsPitr {
    $result = Invoke-AwsRead @('rds','describe-db-instances','--db-instance-identifier','tracepoint-staging-full-aws')
    $instance = @($result.DBInstances) | Select-Object -First 1
    if ($null -eq $instance -or $instance.DBInstanceIdentifier -cne 'tracepoint-staging-full-aws') { throw 'Expected staging RDS instance was not found.' }
    if ($instance.DBInstanceStatus -cne 'available' -or [int]$instance.BackupRetentionPeriod -lt 1 -or $instance.DeletionProtection -ne $true) { throw 'Staging RDS availability, automated backup retention, or deletion protection is unsafe.' }
    if ($null -eq $instance.LatestRestorableTime) { throw 'RDS has no reported PITR latest-restorable time.' }
    $latest = [DateTimeOffset]::Parse([string]$instance.LatestRestorableTime).ToUniversalTime()
    $age = [DateTimeOffset]::UtcNow - $latest
    if ($age -lt [TimeSpan]::Zero -or $age.TotalMinutes -gt $MaximumPitrAgeMinutes) { throw "RDS PITR latest-restorable time is stale ($([Math]::Round($age.TotalMinutes,1)) minutes)." }
    Write-Host "RDS PITR verified: retention $($instance.BackupRetentionPeriod) day(s), latest restorable $($latest.ToString('o'))."
    return $instance
}
function Get-StagingService {
    $result = Invoke-AwsRead @('ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging')
    $service = @($result.services) | Select-Object -First 1
    if ($null -eq $service -or $service.status -cne 'ACTIVE' -or [int]$service.desiredCount -lt 1 -or $service.runningCount -ne $service.desiredCount -or [int]$service.pendingCount -ne 0) { throw 'Staging ECS service is not healthy and steady.' }
    return $service
}
function Assert-StagingRuntimeHealth {
    $service = Get-StagingService
    $tasks = Invoke-AwsRead @('ecs','list-tasks','--cluster','tracepoint-staging','--service-name','tracepoint-staging','--desired-status','RUNNING')
    if (@($tasks.taskArns).Count -ne [int]$service.desiredCount) { throw 'Staging running task count does not match the ECS service desired count.' }
    $taskInfo = Invoke-AwsRead (@('ecs','describe-tasks','--cluster','tracepoint-staging','--tasks') + @($tasks.taskArns))
    foreach ($task in @($taskInfo.tasks)) {
        if ($task.lastStatus -cne 'RUNNING' -or @($task.containers | Where-Object { $_.lastStatus -cne 'RUNNING' -or $_.healthStatus -eq 'UNHEALTHY' }).Count -gt 0) { throw 'A staging application task is not healthy.' }
    }
    foreach ($loadBalancer in @($service.loadBalancers)) {
        $targets = Invoke-AwsRead @('elbv2','describe-target-health','--target-group-arn',[string]$loadBalancer.targetGroupArn)
        if (@($targets.TargetHealthDescriptions).Count -lt [int]$service.desiredCount -or @($targets.TargetHealthDescriptions | Where-Object { $_.TargetHealth.State -cne 'healthy' }).Count -gt 0) { throw 'Staging ALB targets are not all healthy.' }
    }
    try { $health = Invoke-WebRequest -Uri 'https://staging.tracepointhq.com/api/health' -TimeoutSec 20 -ErrorAction Stop }
    catch { throw 'Staging /api/health request failed.' }
    if ([int]$health.StatusCode -ne 200) { throw "Staging /api/health returned HTTP $($health.StatusCode)." }
    return $service
}

$deploymentStarted = $false
$migrationApplyStarted = $false
$previousTaskDefinition = $null
try {
    if (-not (Test-Path (Join-Path $repositoryRoot 'package.json'))) { throw 'TracePoint repository not found.' }
    $head = (Invoke-NativeChecked 'git.exe' @('-C',$repositoryRoot,'rev-parse','HEAD') | Out-String).Trim().ToLowerInvariant()
    if ($head -cne $ToolingCommit) { throw "Tooling HEAD '$head' does not match reviewed tooling commit '$ToolingCommit'." }
    $changes = Invoke-NativeChecked 'git.exe' @('-C',$repositoryRoot,'status','--porcelain','--untracked-files=all')
    if (@($changes).Count -ne 0) { throw 'Release tooling worktree must be clean.' }
    $app = (Invoke-NativeChecked 'git.exe' @('-C',$repositoryRoot,'rev-parse',"$ApplicationCommit^{commit}") | Out-String).Trim().ToLowerInvariant()
    if ($app -cne $ApplicationCommit) { throw 'Application commit is not an exact local commit.' }
    Invoke-NativeChecked 'git.exe' @('-C',$repositoryRoot,'merge-base','--is-ancestor',$ApplicationCommit,$ToolingCommit) | Out-Null

    $identity = Assert-StagingIdentity (Invoke-AwsRead @('sts','get-caller-identity'))
    if ($env:AWS_REGION -cne $region -or $env:AWS_DEFAULT_REGION -cne $region) { throw 'AWS region is not us-east-1.' }
    Write-Host "Verified staging AWS identity: $($identity.Account) / $($identity.Arn)."

    Invoke-NativeChecked (Join-Path $repositoryRoot 'node_modules/.bin/tsc.cmd') @('--noEmit') | Out-Null
    Invoke-NativeChecked 'node.exe' @((Join-Path $repositoryRoot 'scripts/assert-aws-native-provider-reachability.mjs')) | Out-Null
    Invoke-NativeChecked 'powershell.exe' @('-NoProfile','-File',(Join-Path $PSScriptRoot 'migration-release-core.tests.ps1')) | Out-Null

    $previousService = Assert-StagingRuntimeHealth
    $previousTaskDefinition = [string]$previousService.taskDefinition
    if ($previousTaskDefinition -notmatch ':184$') { throw "Expected the reviewed pre-release staging task revision 184; found '$previousTaskDefinition'." }
    $null = Assert-RdsPitr

    Write-Host "Building and scanning application image for $ApplicationCommit; no ECS service update occurs in this step."
    Invoke-ReleaseScript (Join-Path $PSScriptRoot 'publish-tracepoint-staging-image.ps1') @('-Commit',$ApplicationCommit,'-Wait') | Out-Null
    $imageTag = Get-ReviewedImageTag -Environment staging -Commit $ApplicationCommit
    $image = @((Invoke-AwsRead @('ecr','describe-images','--repository-name','tracepoint-staging','--image-ids',"imageTag=$imageTag")).imageDetails) | Select-Object -First 1
    if ($null -eq $image -or @($image.imageTags) -cnotcontains $imageTag) { throw 'Reviewed application image was not published with its exact immutable tag.' }
    $imageDigest = [string]$image.imageDigest
    if ($imageDigest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Reviewed application image digest is invalid.' }

    $statusOutput = Invoke-ReleaseScript (Join-Path $PSScriptRoot 'migrate-db.ps1') @('staging','-Action','status','-ImageCommit',$ApplicationCommit)
    $status = Get-VerifiedLedgerReport -Output $statusOutput -Expectation 'before-apply' -ExpectedDigest $imageDigest
    if (@($status.pending).Count -ne 1 -or $status.pending[0].version -ne 38 -or $status.pending[0].filename -cne '038_default_module_entitlements.sql') { throw 'Pre-apply status must show exactly migration 038 pending.' }
    $null = Assert-RdsPitr
    $currentService = Get-StagingService
    if ($currentService.taskDefinition -cne $previousTaskDefinition) { throw 'Staging application task changed during migration preparation; stop for review.' }

    $confirmation = Read-Host "Type APPLY 038 to mutate staging account $account database using image $imageDigest"
    if ($confirmation -cne 'APPLY 038') { throw 'Database apply was not confirmed; no migration was started.' }
    $migrationApplyStarted = $true
    $applyOutput = Invoke-ReleaseScript (Join-Path $PSScriptRoot 'migrate-db.ps1') @('staging','-Action','apply','-ImageCommit',$ApplicationCommit,'-ExpectedImageDigest',$imageDigest)
    $applied = Get-VerifiedLedgerReport -Output $applyOutput -Expectation 'after-apply' -ExpectedDigest $imageDigest
    if (@($applied.pending).Count -ne 0) { throw 'Post-apply ledger still has pending migrations.' }
    $finalOutput = Invoke-ReleaseScript (Join-Path $PSScriptRoot 'migrate-db.ps1') @('staging','-Action','status','-ImageCommit',$ApplicationCommit,'-ExpectedImageDigest',$imageDigest)
    $finalStatus = Get-VerifiedLedgerReport -Output $finalOutput -Expectation 'after-apply' -ExpectedDigest $imageDigest
    if (@($finalStatus.pending).Count -ne 0) { throw 'Final migration status did not verify an empty pending set.' }

    $confirmation = Read-Host 'Type DEPLOY APPLICATION to update the staging ECS application service'
    if ($confirmation -cne 'DEPLOY APPLICATION') { throw 'Application deployment was not confirmed; database migration remains applied.' }
    $currentService = Get-StagingService
    if ($currentService.taskDefinition -cne $previousTaskDefinition) { throw 'Staging application task changed after migration; do not deploy this release.' }
    $deploymentStarted = $true
    Invoke-ReleaseScript (Join-Path $PSScriptRoot 'deploy-app.ps1') @('staging','-ImageCommit',$ApplicationCommit,'-ExpectedImageDigest',$imageDigest) | Out-Null
    $null = Assert-StagingRuntimeHealth
    Write-Host "STAGING RELEASE VERIFIED: application $ApplicationCommit ($imageDigest); migration 038 applied; prior task $previousTaskDefinition."
}
catch {
    $failure = $_
    if ($migrationApplyStarted -and -not $deploymentStarted) {
        Write-Warning 'Migration apply did not complete all verification. Do not deploy the application or blindly retry. Run migration status and reconcile the ledger before continuing; the additive migration is never reversed automatically.'
    }
    if ($deploymentStarted -and $previousTaskDefinition) {
        try {
            $serviceResult = Invoke-AwsRead @('ecs','describe-services','--cluster','tracepoint-staging','--services','tracepoint-staging')
            $service = @($serviceResult.services) | Select-Object -First 1
            if ($null -ne $service -and $service.taskDefinition -cne $previousTaskDefinition) {
                Write-Warning 'Application release failed after migration; restoring the prior ECS task revision. Migration 038 remains applied.'
                Invoke-ReleaseScript (Join-Path $PSScriptRoot 'deploy-app.ps1') @('staging','-RollbackTaskDefinitionArn',$previousTaskDefinition) | Out-Null
            }
        } catch { throw "Release failed: $($failure.Exception.Message). Application rollback also failed: $($_.Exception.Message). Migration 038 was not reversed; stop and recover forward." }
    }
    throw
}
finally {
    $env:AWS_PROFILE = $oldAwsProfile
    $env:AWS_REGION = $oldAwsRegion
    $env:AWS_DEFAULT_REGION = $oldAwsDefaultRegion
}
