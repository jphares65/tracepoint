$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-app-rollout-core.ps1')

$imageMissing = [System.Management.Automation.ErrorRecord]::new(
    [System.Exception]::new('AWS command failed: aws ecr describe-images :: An error occurred (ImageNotFoundException) when calling the DescribeImages operation: Image not found.'),
    'ECR_IMAGE_NOT_FOUND', [System.Management.Automation.ErrorCategory]::ObjectNotFound, $null)
if (-not (Test-EcrImageNotFoundError -ErrorRecord $imageMissing)) { throw 'A genuine ECR ImageNotFoundException must permit first publication.' }
foreach ($diagnostic in @(
    'An error occurred (AccessDeniedException) when calling the DescribeImages operation: denied',
    'Could not connect to the endpoint URL: https://ecr.us-east-1.amazonaws.com/'
)) {
    $failure = [System.Management.Automation.ErrorRecord]::new([System.Exception]::new($diagnostic), 'ECR_LOOKUP_FAILED', [System.Management.Automation.ErrorCategory]::ResourceUnavailable, $null)
    if (Test-EcrImageNotFoundError -ErrorRecord $failure) { throw 'ECR access and network failures must not be mistaken for a missing image.' }
}

function New-TestService {
    param([string]$State, [string]$TaskArn = 'arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:111')
    [pscustomobject]@{
        taskDefinition = $TaskArn
        runningCount = 1
        desiredCount = 1
        pendingCount = 0
        deployments = @([pscustomobject]@{ status = 'PRIMARY'; taskDefinition = $TaskArn; rolloutState = $State })
    }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Expected)
    try { & $Action } catch {
        if ($_.Exception.Message -like "*$Expected*") { return }
        throw "Expected failure containing '$Expected'; received '$($_.Exception.Message)'."
    }
    throw "Expected failure containing '$Expected', but no failure occurred."
}

$script:clock = [DateTimeOffset]::Parse('2026-10-02T12:00:00Z')
$script:services = @((New-TestService 'IN_PROGRESS'), (New-TestService 'IN_PROGRESS'), (New-TestService 'COMPLETED'))
$script:index = 0
$completedArguments = @{
    ExpectedTaskArn = $script:services[0].taskDefinition; Invariant = 'stable'
    GetService = { $value = $script:services[[Math]::Min($script:index, $script:services.Count - 1)]; $script:index++; $value }
    GetInvariant = { param($service) 'stable' }; Now = { $script:clock }
    Sleep = { param($seconds) $script:clock = $script:clock.AddSeconds($seconds) }
    TimeoutSeconds = 180; PollIntervalSeconds = 30
}
$completed = Wait-ExpectedEcsRolloutCompletion @completedArguments
if ($completed.deployments[0].rolloutState -ne 'COMPLETED' -or $script:index -ne 3) { throw 'IN_PROGRESS to COMPLETED regression test failed.' }

Assert-Throws -Expected 'rollout failed' -Action {
    $arguments = @{ ExpectedTaskArn = (New-TestService 'FAILED').taskDefinition; Invariant = 'stable'; GetService = { New-TestService 'FAILED' }; GetInvariant = { param($service) 'stable' }; TimeoutSeconds = 180 }
    Wait-ExpectedEcsRolloutCompletion @arguments
}

$script:clock = [DateTimeOffset]::Parse('2026-10-02T12:00:00Z')
Assert-Throws -Expected 'within 180 seconds' -Action {
    $arguments = @{ ExpectedTaskArn = (New-TestService 'IN_PROGRESS').taskDefinition; Invariant = 'stable'; GetService = { New-TestService 'IN_PROGRESS' }; GetInvariant = { param($service) 'stable' }; Now = { $script:clock }; Sleep = { param($seconds) $script:clock = $script:clock.AddSeconds($seconds) }; TimeoutSeconds = 180; PollIntervalSeconds = 60 }
    Wait-ExpectedEcsRolloutCompletion @arguments
}

# deploy-app.ps1 publishes and migrate-db.ps1 requires this tag. The staging
# buildspec accepts only the suffixed form; a bare SHA can never be published.
$sha = 'a' * 40
$buildspecTag = '^(migration-)?[0-9a-f]{40}-aws-native-staging$'
if ((Get-ApplicationImageTag -Environment staging -Commit $sha) -ne "$sha-aws-native-staging") { throw 'Staging application image tag regression test failed.' }
if ((Get-ApplicationImageTag -Environment production -Commit $sha) -ne "$sha-aws-native-production") { throw 'Production application image tag regression test failed.' }
if ((Get-ApplicationImageTag -Environment Staging -Commit $sha) -cne "$sha-aws-native-staging") { throw 'Application image tag must not depend on parameter case.' }
if ((Get-ApplicationImageTag -Environment staging -Commit $sha) -notmatch $buildspecTag) { throw 'Staging application image tag does not satisfy the staging buildspec.' }
Assert-Throws -Expected 'Commit' -Action { Get-ApplicationImageTag -Environment staging -Commit 'latest' }
Assert-Throws -Expected 'Environment' -Action { Get-ApplicationImageTag -Environment preview -Commit $sha }

$cleanEmpty = '{"imageScanStatus":{"status":"COMPLETE"},"imageScanFindings":{"findingSeverityCounts":null}}' | ConvertFrom-Json
$cleanZero = '{"imageScanStatus":{"status":"COMPLETE"},"imageScanFindings":{"findingSeverityCounts":{"LOW":0}}}' | ConvertFrom-Json
$dirty = '{"imageScanStatus":{"status":"COMPLETE"},"imageScanFindings":{"findingSeverityCounts":{"LOW":0,"HIGH":1}}}' | ConvertFrom-Json
$pending = '{"imageScanStatus":{"status":"IN_PROGRESS"},"imageScanFindings":{"findingSeverityCounts":null}}' | ConvertFrom-Json
if (-not (Test-CleanImageScan $cleanEmpty) -or -not (Test-CleanImageScan $cleanZero)) { throw 'Clean image scan regression test failed.' }
if ((Test-CleanImageScan $dirty) -or (Test-CleanImageScan $pending)) { throw 'Unclean image scan regression test failed.' }

Write-Host 'deploy-app rollout guard regression tests passed.'
