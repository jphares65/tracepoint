Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:LeaseRenewalCalls = @()
$global:LeaseRenewalValue = $null
function global:aws.exe {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    $global:LeaseRenewalCalls += $command
    if ($command -like 'sts get-caller-identity*') { return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}' }
    if ($command -like 'ssm put-parameter*') {
        $valueIndex = [Array]::IndexOf($args, '--value')
        if ($valueIndex -lt 0) { throw 'Lease write omitted its value.' }
        $global:LeaseRenewalValue = $args[$valueIndex + 1]
        return '{"Version":1}'
    }
    if ($command -like 'ssm get-parameter*') { return (@{ Parameter = @{ Value = $global:LeaseRenewalValue } } | ConvertTo-Json -Compress) }
    throw 'Unexpected mocked AWS query.'
}
try {
    $expiry = [DateTime]::UtcNow.AddDays(2).ToString("yyyy-MM-ddTHH:mm:ssZ")
    & (Join-Path $PSScriptRoot 'renew-staging-database-lease.ps1') -ExpiresAfterUtc $expiry -LeaseOwner 'github-release' -LeaseReference 'github:1:1' -Execute | Out-Null
    if (@($global:LeaseRenewalCalls | Where-Object { $_ -match 'cloudformation|secretsmanager|ecs|rds' }).Count -ne 0) { throw 'Lease renewal called an out-of-scope AWS service.' }
    if (@($global:LeaseRenewalCalls | Where-Object { $_ -match '^ssm put-parameter' }).Count -ne 1 -or @($global:LeaseRenewalCalls | Where-Object { $_ -match '^ssm get-parameter' }).Count -ne 1) { throw 'Lease renewal did not perform exactly one SSM write/readback.' }
    $stored = $global:LeaseRenewalValue | ConvertFrom-Json
    if ($stored.expiresAfterUtc -notmatch 'Z$' -or $stored.leaseOwner -ne 'github-release' -or $stored.leaseReference -ne 'github:1:1') { throw 'Lease JSON shape or contents are wrong.' }
    Write-Host 'Passed SSM-only lease renewal write/readback test; no CloudFormation or runtime calls.'
} finally { Remove-Item Function:/aws.exe }
$global:LASTEXITCODE = 0
