Set-StrictMode -Version Latest

function Wait-ExpectedEcsRolloutCompletion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ExpectedTaskArn,
        [Parameter(Mandatory)][string]$Invariant,
        [Parameter(Mandatory)][scriptblock]$GetService,
        [Parameter(Mandatory)][scriptblock]$GetInvariant,
        [scriptblock]$Now = { [DateTimeOffset]::UtcNow },
        [scriptblock]$Sleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds },
        [ValidateRange(150, 1800)][int]$TimeoutSeconds = 420,
        [ValidateRange(1, 60)][int]$PollIntervalSeconds = 5
    )

    # The staging target group requires five 30-second healthy checks. Allow
    # that normal registration interval plus startup margin before rollback.
    $deadline = (& $Now).AddSeconds($TimeoutSeconds)
    do {
        $service = & $GetService
        if ((& $GetInvariant $service) -ne $Invariant) { throw 'Unexpected ECS service infrastructure change detected.' }
        if ($service.taskDefinition -ne $ExpectedTaskArn) { throw 'ECS changed away from the expected task revision.' }

        $primaryDeployment = @($service.deployments | Where-Object { $_.status -eq 'PRIMARY' }) | Select-Object -First 1
        if ($null -eq $primaryDeployment -or $primaryDeployment.taskDefinition -ne $ExpectedTaskArn) { throw 'The expected task revision is not the ECS primary deployment.' }

        switch ([string]$primaryDeployment.rolloutState) {
            'COMPLETED' { return $service }
            'FAILED' { throw 'ECS rollout failed for the expected task revision.' }
            'IN_PROGRESS' {
                # During a healthy rolling replacement ECS can temporarily have
                # an old task draining while the new one registers. A deficit is
                # unhealthy; surplus/pending counts are normal until completion.
                if ($service.runningCount -lt $service.desiredCount) { throw 'ECS service has fewer running tasks than desired during rollout.' }
            }
            default { throw "ECS rollout entered unexpected state '$($primaryDeployment.rolloutState)'." }
        }

        if ((& $Now) -ge $deadline) { break }
        & $Sleep $PollIntervalSeconds
    } while ($true)

    throw "ECS rollout did not complete the expected task revision within $TimeoutSeconds seconds."
}
