$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'migration-release-core.psm1') -Force

function Assert-Throws {
    param([scriptblock]$Action,[string]$Expected)
    try { & $Action | Out-Null }
    catch { if ($_.Exception.Message -like "*$Expected*") { return }; throw "Expected '$Expected', received '$($_.Exception.Message)'" }
    throw "Expected failure containing '$Expected'."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$migrationFiles = @(Get-ChildItem (Join-Path $repoRoot 'database/aws') -File | Where-Object { $_.Name -match '^[0-9]{3}_[a-z0-9_]+\.sql$' } | Sort-Object Name)
$applied = @($migrationFiles | Select-Object -First 37 | ForEach-Object {
    [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$pending38 = @($migrationFiles | Select-Object -Last 1 | ForEach-Object {
    [pscustomobject]@{ version=38; filename=$_.Name; content_sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$before = [pscustomobject]@{ ledger='present'; applied=$applied; pending=$pending38 }
$entitlementRecord = [pscustomobject]@{ version=38; filename='038_default_module_entitlements.sql'; content_sha256=$pending38[0].content_sha256; application_git_sha='b' * 40; environment='staging'; application_context='apply'; is_baseline=$false }
$after = [pscustomobject]@{ ledger='present'; applied=@($applied + $entitlementRecord); pending=@() }

if ((Get-ReviewedImageTag staging ('a' * 40)) -cne (('a' * 40) + '-aws-native-staging')) { throw 'Staging image tag success case failed.' }
Assert-Throws { Assert-ReviewedImageTag staging ('a' * 40) (('a' * 40) + '-aws-native-production') } 'does not match reviewed tag'
foreach ($branch in @('codex/aws-staging-readiness-20260902','codex/aws-staging-integration-20260908','codex/staging-mobile-api-release-20261007')) {
    Assert-ReleaseBranch $branch | Out-Null
}
Assert-ReleaseBranch 'codex/demo-pd-module-visibility' | Out-Null
Assert-Throws { Assert-ReleaseBranch 'feature/unreviewed-release' } 'unapproved branch'

$identity = [pscustomobject]@{ Account='559054714699'; Arn='arn:aws:sts::559054714699:assumed-role/AWSReservedSSO_TracePointMigrationStaging_test/operator' }
Assert-StagingIdentity $identity | Out-Null
Assert-Throws { Assert-StagingIdentity ([pscustomobject]@{ Account='193644343389'; Arn='arn:aws:sts::193644343389:assumed-role/TracePointMigrationStaging/operator' }) } 'Wrong AWS account'
Assert-ImageDigest ('sha256:' + ('a' * 64)) ('sha256:' + ('a' * 64)) | Out-Null
Assert-Throws { Assert-ImageDigest ('sha256:' + ('a' * 64)) ('sha256:' + ('b' * 64)) } 'does not match'

$validMessages = @('{"applying":{"version":38}}',($before | ConvertTo-Json -Compress -Depth 10))
$parsed = ConvertFrom-MigrationRunnerLog -Messages $validMessages
if ($parsed.ledger -cne 'present') { throw 'Migration log report success case failed.' }
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @() } 'logs are missing'
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @('{malformed json') } 'malformed JSON'
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @((ConvertTo-Json -Compress $before),(ConvertTo-Json -Compress $before)) } 'found 2'

Assert-MigrationLedgerReport -Report $before -MigrationFiles @($migrationFiles.FullName) -Expectation before-apply | Out-Null
Assert-MigrationLedgerReport -Report $after -MigrationFiles @($migrationFiles.FullName) -Expectation after-apply | Out-Null
Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('b' * 40) -Environment staging | Out-Null
Assert-Throws { Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('c' * 40) -Environment staging } 'does not match'
$wrongEnvironmentRecord = [pscustomobject]@{ ledger='present'; applied=@($applied + [pscustomobject]@{ version=38; filename=$entitlementRecord.filename; content_sha256=$entitlementRecord.content_sha256; application_git_sha=$entitlementRecord.application_git_sha; environment='production'; application_context='apply'; is_baseline=$false }); pending=@() }
Assert-Throws { Assert-EntitlementMigrationRecord -Report $wrongEnvironmentRecord -ApplicationCommit ('b' * 40) -Environment staging } 'does not match'
$gap = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -ne 37); pending=$pending38 }
Assert-Throws { Assert-MigrationLedgerReport -Report $gap -MigrationFiles @($migrationFiles.FullName) -Expectation before-apply } 'gap or overlap at version 37'
$driftApplied = @($applied | ForEach-Object { if ($_.version -eq 7) { [pscustomobject]@{ version=$_.version; filename=$_.filename; content_sha256=('0' * 64) } } else { $_ } })
$drift = [pscustomobject]@{ ledger='present'; applied=$driftApplied; pending=$pending38 }
Assert-Throws { Assert-MigrationLedgerReport -Report $drift -MigrationFiles @($migrationFiles.FullName) -Expectation before-apply } 'content drift at version 7'
$multiple = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -lt 37); pending=@($migrationFiles | Select-Object -Last 2 | ForEach-Object { [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } }) }
Assert-Throws { Assert-MigrationLedgerReport -Report $multiple -MigrationFiles @($migrationFiles.FullName) -Expectation before-apply } 'exactly 038_default_module_entitlements.sql pending'
$absent = [pscustomobject]@{ ledger='absent'; applied=@(); pending=@() }
Assert-Throws { Assert-MigrationLedgerReport -Report $absent -MigrationFiles @($migrationFiles.FullName) } 'ledger is absent'

Write-Host 'migration release core tests passed.'
