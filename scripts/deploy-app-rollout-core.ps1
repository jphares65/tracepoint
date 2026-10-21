Set-StrictMode -Version Latest

function Test-EcrImageNotFoundError {
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Management.Automation.ErrorRecord]$ErrorRecord)
    return ([string]$ErrorRecord.Exception.Message -match '(?i)\(ImageNotFoundException\)\s+when calling the DescribeImages operation:')
}

# The one application image tag contract. deploy-app.ps1 publishes this tag and
# migrate-db.ps1 requires it; buildspec.staging-image.yml accepts only the
# suffixed form, so the two must never compute it separately.
function Get-ApplicationImageTag {
    param([Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Environment, [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit)
    return "$Commit-aws-native-$($Environment.ToLowerInvariant())"
}

function Test-CleanImageScan {
    param([Parameter(Mandatory)]$Scan)
    if ($Scan.imageScanStatus.status -ne 'COMPLETE') { return $false }
    $severityCounts = $Scan.imageScanFindings.findingSeverityCounts
    if ($null -eq $severityCounts) { return $true }
    foreach ($severity in $severityCounts.PSObject.Properties) {
        if ([int]$severity.Value -gt 0) { return $false }
    }
    return $true
}

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
