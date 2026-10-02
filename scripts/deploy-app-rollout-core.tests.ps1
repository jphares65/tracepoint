$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-app-rollout-core.ps1')

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

Write-Host 'deploy-app rollout guard regression tests passed.'
