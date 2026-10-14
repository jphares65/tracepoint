$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'migration-release-core.psm1') -Force

function Assert-Throws {
    param([scriptblock]$Action,[string]$Expected)
    try { & $Action | Out-Null }
    catch { if ($_.Exception.Message -like "*$Expected*") { return }; throw "Expected '$Expected', received '$($_.Exception.Message)'" }
    throw "Expected failure containing '$Expected'."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$migrationFiles = @(Get-AwsMigrationFiles -Directory (Join-Path $repoRoot 'database/aws') | ForEach-Object { Get-Item -LiteralPath $_ })
$testCommit = (& git.exe -C $repoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $testCommit -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve the reviewed migration test commit.' }
$archiveHashes = Get-AwsMigrationArchiveHashes -RepositoryRoot $repoRoot -Commit $testCommit
if ($archiveHashes['038_agency_documents_template_builder.sql'] -cne '83f1ffdb10c646d4b7ac7e1d0478b009d53da214cbc4407c12f6b9db6edf1e3a') { throw 'Migration 038 canonical archive checksum changed.' }
if ($archiveHashes['042_default_module_entitlements.sql'] -cne 'f24425f5370f1ab32ec7074b13dd56f5b00afa5ab757039ca431f7312c27a4b4') { throw 'Migration 042 canonical archive checksum changed.' }
$local42Hash = (Get-FileHash (Join-Path $repoRoot 'database/aws/042_default_module_entitlements.sql') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($local42Hash -ceq $archiveHashes['042_default_module_entitlements.sql']) { throw 'Expected Windows working-tree line endings to differ from canonical migration 042 archive bytes.' }
$applied = @($migrationFiles | Select-Object -First 41 | ForEach-Object {
    [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=$archiveHashes[$_.Name] }
})
$pending42 = @($migrationFiles | Select-Object -Last 1 | ForEach-Object {
    [pscustomobject]@{ version=42; filename=$_.Name; content_sha256=$archiveHashes[$_.Name] }
})
$before = [pscustomobject]@{ ledger='present'; applied=$applied; pending=$pending42 }
$entitlementRecord = [pscustomobject]@{ version=42; filename='042_default_module_entitlements.sql'; content_sha256=$pending42[0].content_sha256; application_git_sha='b' * 40; environment='staging'; application_context='apply'; is_baseline=$false }
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

$validMessages = @('{"applying":{"version":42}}',($before | ConvertTo-Json -Compress -Depth 10))
$parsed = ConvertFrom-MigrationRunnerLog -Messages $validMessages
if ($parsed.ledger -cne 'present') { throw 'Migration log report success case failed.' }
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @() } 'logs are missing'
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @('{malformed json') } 'malformed JSON'
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @((ConvertTo-Json -Compress $before),(ConvertTo-Json -Compress $before)) } 'found 2'

Assert-MigrationLedgerReport -Report $before -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply | Out-Null
Assert-MigrationLedgerReport -Report $after -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation after-apply | Out-Null
Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('b' * 40) -Environment staging | Out-Null
Assert-Throws { Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('c' * 40) -Environment staging } 'does not match'
$wrongEnvironmentRecord = [pscustomobject]@{ ledger='present'; applied=@($applied + [pscustomobject]@{ version=42; filename=$entitlementRecord.filename; content_sha256=$entitlementRecord.content_sha256; application_git_sha=$entitlementRecord.application_git_sha; environment='production'; application_context='apply'; is_baseline=$false }); pending=@() }
Assert-Throws { Assert-EntitlementMigrationRecord -Report $wrongEnvironmentRecord -ApplicationCommit ('b' * 40) -Environment staging } 'does not match'
$gap = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -ne 37); pending=$pending42 }
Assert-Throws { Assert-MigrationLedgerReport -Report $gap -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'gap or overlap at version 37'
$driftApplied = @($applied | ForEach-Object { if ($_.version -eq 7) { [pscustomobject]@{ version=$_.version; filename=$_.filename; content_sha256=('0' * 64) } } else { $_ } })
$drift = [pscustomobject]@{ ledger='present'; applied=$driftApplied; pending=$pending42 }
Assert-Throws { Assert-MigrationLedgerReport -Report $drift -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'content drift at version 7'
$badPending = [pscustomobject]@{ ledger='present'; applied=$applied; pending=@([pscustomobject]@{ version=42; filename='042_default_module_entitlements.sql'; content_sha256=('0' * 64) }) }
Assert-Throws { Assert-MigrationLedgerReport -Report $badPending -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'Pending migration hash drift at version 42.'
$multiple = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -le 40); pending=@($migrationFiles | Select-Object -Last 2 | ForEach-Object { [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=$archiveHashes[$_.Name] } }) }
Assert-Throws { Assert-MigrationLedgerReport -Report $multiple -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'exactly 042_default_module_entitlements.sql pending'
Assert-Throws { Assert-MigrationLedgerReport -Report $before -MigrationFiles @($migrationFiles.FullName + $migrationFiles[0].FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit } 'Duplicate AWS migration version 1.'

$duplicateDirectory = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-duplicate-migration-test-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $duplicateDirectory | Out-Null
    [IO.File]::WriteAllText((Join-Path $duplicateDirectory '001_first.sql'), 'select 1;')
    [IO.File]::WriteAllText((Join-Path $duplicateDirectory '001_second.sql'), 'select 2;')
    Assert-Throws { Get-AwsMigrationFiles -Directory $duplicateDirectory | Out-Null } 'Duplicate AWS migration version 1.'
} finally { if (Test-Path -LiteralPath $duplicateDirectory) { Remove-Item -LiteralPath $duplicateDirectory -Recurse -Force } }

foreach ($scriptName in @('migrate-db.ps1','apply-app-migrations.ps1','release-entitlements-staging.ps1')) {
    $scriptText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $scriptName))
    $preflight = $scriptText.IndexOf('Get-AwsMigrationFiles', [StringComparison]::Ordinal)
    if ($preflight -lt 0) { throw "$scriptName does not validate migration versions locally." }
    $awsBoundary = switch ($scriptName) {
        'migrate-db.ps1' { [regex]::Match($scriptText, '(?m)^Assert-Identity\s*$').Index }
        'apply-app-migrations.ps1' { [regex]::Match($scriptText, '(?m)^Assert-Identity\s*$').Index }
        'release-entitlements-staging.ps1' { $scriptText.IndexOf('function Invoke-AwsRead', [StringComparison]::Ordinal) }
    }
    if ($awsBoundary -lt 0 -or $preflight -gt $awsBoundary) { throw "$scriptName reaches AWS before migration-version preflight." }
}

$absent = [pscustomobject]@{ ledger='absent'; applied=@(); pending=@() }
Assert-Throws { Assert-MigrationLedgerReport -Report $absent -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit } 'ledger is absent'

Write-Host 'migration release core tests passed.'
