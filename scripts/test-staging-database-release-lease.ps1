Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:LeaseTestScenario = 'valid'
$global:LeaseAwsCalls = @()
function global:aws.exe {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    $global:LeaseAwsCalls += $command
    if ($command -like 'sts get-caller-identity*') { return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}' }
    if ($command -like 'ssm get-parameter*') {
        if ($global:LeaseTestScenario -eq 'missing') { $global:LASTEXITCODE = 1; return }
        $value = switch ($global:LeaseTestScenario) {
            'invalid-json' { '{not-json' }
            'expired' { '{"expiresAfterUtc":"2020-01-01T00:00:00Z","leaseOwner":"github-release","leaseReference":"github:1:1"}' }
            default { '{"expiresAfterUtc":"'+[DateTime]::UtcNow.AddDays(2).ToString("yyyy-MM-ddTHH:mm:ssZ")+'","leaseOwner":"github-release","leaseReference":"github:1:1"}' }
        }
        return (@{ Parameter = @{ Value = $value } } | ConvertTo-Json -Compress)
    }
    throw 'Unexpected mocked AWS query.'
}
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
function Must-Reject([scriptblock]$Action) { try { & $Action } catch { return }; throw 'Lease guard accepted an invalid parameter.' }
try {
    $lease = Assert-TracePointStagingDatabaseReleaseLease
    if ($lease.leaseOwner -ne 'github-release') { throw 'Valid SSM lease was not accepted.' }
    foreach ($scenario in @('missing','invalid-json','expired')) { $global:LeaseTestScenario = $scenario; Must-Reject { Assert-TracePointStagingDatabaseReleaseLease | Out-Null } }
    if ($global:LeaseAwsCalls | Where-Object { $_ -match 'cloudformation|describe-stacks' }) { throw 'Lease guard read legacy CloudFormation tags.' }
    if (@($global:LeaseAwsCalls | Where-Object { $_ -notmatch '^(sts get-caller-identity|ssm get-parameter)' }).Count -ne 0) { throw 'Lease guard made an unapproved AWS call.' }
    Write-Host 'Passed valid, missing, invalid JSON, and expired SSM lease guard cases; no CloudFormation calls.'
} finally { Remove-Item Function:/aws.exe }
$global:LASTEXITCODE = 0
