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
# Ledger hashes come from the canonical archive bytes, not the working tree. That is observable only in an LF
# checkout; with core.autocrlf=true the working tree already holds the canonical CRLF bytes.
$local42Path = Join-Path $repoRoot 'database/aws/042_default_module_entitlements.sql'
$local42Hash = (Get-FileHash $local42Path -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not ([IO.File]::ReadAllText($local42Path).Contains("`r`n")) -and $local42Hash -ceq $archiveHashes['042_default_module_entitlements.sql']) { throw 'Expected LF working-tree bytes to differ from canonical migration 042 archive bytes.' }
# Staging's recorded ledger hashes for 038-042, from its last status report (2026-10-14 14:22 UTC). The canonical
# archive bytes of this branch must still produce exactly these, or the release would stop on content drift.
$stagingRecorded = @{
    '038_agency_documents_template_builder.sql' = '83f1ffdb10c646d4b7ac7e1d0478b009d53da214cbc4407c12f6b9db6edf1e3a'
    '039_document_template_analysis.sql' = 'ef5a8670edc6dba6835a174fd51c296fb94ab8a793aee04ce1ac6c23a2059292'
    '040_document_template_structured_bindings.sql' = '640a5c8093413a17b3996b45cdf460d7579411c62ee779e882c645801f41036e'
    '041_document_template_write_authority.sql' = '72ba79c43da8c4f96145a4c2a8300bc9c2e61d78a85f1e914d8bb0c9081a5d69'
    '042_default_module_entitlements.sql' = 'f24425f5370f1ab32ec7074b13dd56f5b00afa5ab757039ca431f7312c27a4b4'
}
foreach ($name in $stagingRecorded.Keys) { if ($archiveHashes[$name] -cne $stagingRecorded[$name]) { throw "Migration $name no longer matches the hash staging recorded." } }
# Staging records 001-045: Agency Documents at 038-041 and module entitlements at 042 (applied by the staging line's
# release, a3fa985), and 043-045 (applied by e3b06e6a on 2026-10-19). This release applies only 046.
$migrationCommit = 'e3b06e6ada3a7ef93f41f49831d0723dd345e7d7'
$applied = @($migrationFiles | Select-Object -First 45 | ForEach-Object {
    $record = [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=$archiveHashes[$_.Name] }
    if ($record.version -eq 42) { $record | Add-Member -NotePropertyMembers @{ application_git_sha='a3fa9855f4c797dfb7b4dd16144cf6c85a445946'; environment='staging'; application_context='apply'; is_baseline=$false } }
    if ($record.version -ge 43) { $record | Add-Member -NotePropertyMembers @{ application_git_sha=$migrationCommit; environment='staging'; application_context='apply'; is_baseline=$false } }
    $record
})
$pending46 = @($migrationFiles | Select-Object -Last 1 | ForEach-Object {
    [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=$archiveHashes[$_.Name] }
})
if ((@($pending46 | ForEach-Object { $_.version }) -join ',') -cne '46') { throw 'Expected migration 046 to follow the recorded 001-045.' }
$before = [pscustomobject]@{ ledger='present'; applied=$applied; pending=$pending46 }
$releaseRecords = @($pending46 | ForEach-Object { [pscustomobject]@{ version=$_.version; filename=$_.filename; content_sha256=$_.content_sha256; application_git_sha='b' * 40; environment='staging'; application_context='apply'; is_baseline=$false } })
$firstReleaseRecord = $releaseRecords[0]
$after = [pscustomobject]@{ ledger='present'; applied=@($applied + $releaseRecords); pending=@() }

if ((Get-ReviewedImageTag staging ('a' * 40)) -cne (('a' * 40) + '-aws-native-staging')) { throw 'Staging image tag success case failed.' }
Assert-Throws { Assert-ReviewedImageTag staging ('a' * 40) (('a' * 40) + '-aws-native-production') } 'does not match reviewed tag'
foreach ($branch in @('codex/aws-staging-readiness-20260902','codex/aws-staging-integration-20260908','codex/staging-mobile-api-release-20261007')) {
    Assert-ReleaseBranch $branch | Out-Null
}
Assert-ReleaseBranch 'codex/demo-pd-module-visibility' | Out-Null
Assert-ReleaseBranch 'claude/staging-release-agency-documents' | Out-Null
Assert-ReleaseBranch 'claude/staging-rc-agency-documents-20261018' | Out-Null
Assert-Throws { Assert-ReleaseBranch 'feature/unreviewed-release' } 'unapproved branch'

$identity = [pscustomobject]@{ Account='559054714699'; Arn='arn:aws:sts::559054714699:assumed-role/AWSReservedSSO_TracePointMigrationStaging_test/operator' }
Assert-StagingIdentity $identity | Out-Null
Assert-Throws { Assert-StagingIdentity ([pscustomobject]@{ Account='193644343389'; Arn='arn:aws:sts::193644343389:assumed-role/TracePointMigrationStaging/operator' }) } 'Wrong AWS account'
Assert-ImageDigest ('sha256:' + ('a' * 64)) ('sha256:' + ('a' * 64)) | Out-Null
Assert-Throws { Assert-ImageDigest ('sha256:' + ('a' * 64)) ('sha256:' + ('b' * 64)) } 'does not match'

$validMessages = @('{"applying":{"version":46}}',($before | ConvertTo-Json -Compress -Depth 10))
$parsed = ConvertFrom-MigrationRunnerLog -Messages $validMessages
if ($parsed.ledger -cne 'present') { throw 'Migration log report success case failed.' }
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @() } 'logs are missing'
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @('{malformed json') } 'malformed JSON'
Assert-Throws { ConvertFrom-MigrationRunnerLog -Messages @((ConvertTo-Json -Compress $before),(ConvertTo-Json -Compress $before)) } 'found 2'

Assert-MigrationLedgerReport -Report $before -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply | Out-Null
Assert-MigrationLedgerReport -Report $after -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation after-apply | Out-Null
Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('b' * 40) -Environment staging | Out-Null
Assert-Throws { Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('c' * 40) -Environment staging } 'does not match'
$wrongEnvironmentRecord = [pscustomobject]@{ ledger='present'; applied=@($applied + [pscustomobject]@{ version=46; filename=$firstReleaseRecord.filename; content_sha256=$firstReleaseRecord.content_sha256; application_git_sha=$firstReleaseRecord.application_git_sha; environment='production'; application_context='apply'; is_baseline=$false }); pending=@() }
Assert-Throws { Assert-EntitlementMigrationRecord -Report $wrongEnvironmentRecord -ApplicationCommit ('b' * 40) -Environment staging } 'does not match'
# 043-045 keep the provenance of the release that applied them.
Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit $migrationCommit -Environment staging -Versions 43,44,45 | Out-Null
Assert-Throws { Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('b' * 40) -Environment staging -Versions 43,44,45 } 'Migration 043 ledger entry'
Assert-Throws { Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('b' * 40) -Environment staging -Versions 42 } 'does not belong to the set'
# The state the previous release expected (043-045 pending on top of 001-042) is no longer staging's state and must stop this release.
$old043Pending = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -le 42); pending=@($migrationFiles | Select-Object -Last 4 | ForEach-Object { [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=$archiveHashes[$_.Name] } }) }
Assert-Throws { Assert-MigrationLedgerReport -Report $old043Pending -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'exactly migration 046 pending'
$gap = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -ne 37); pending=$pending46 }
Assert-Throws { Assert-MigrationLedgerReport -Report $gap -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'gap or overlap at version 37'
$driftApplied = @($applied | ForEach-Object { if ($_.version -eq 7) { [pscustomobject]@{ version=$_.version; filename=$_.filename; content_sha256=('0' * 64) } } else { $_ } })
$drift = [pscustomobject]@{ ledger='present'; applied=$driftApplied; pending=$pending46 }
Assert-Throws { Assert-MigrationLedgerReport -Report $drift -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'content drift at version 7'
# A recorded 042 or 045 whose bytes differ from this branch's file is drift, not something to re-apply.
foreach ($driftVersion in @(42, 45)) {
    $driftRecorded = [pscustomobject]@{ ledger='present'; applied=@($applied | ForEach-Object { if ($_.version -eq $driftVersion) { [pscustomobject]@{ version=$driftVersion; filename=$_.filename; content_sha256=('0' * 64) } } else { $_ } }); pending=$pending46 }
    Assert-Throws { Assert-MigrationLedgerReport -Report $driftRecorded -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } "content drift at version $driftVersion"
}
$badPending = [pscustomobject]@{ ledger='present'; applied=$applied; pending=@([pscustomobject]@{ version=46; filename='046_agency_documents_module_toggle.sql'; content_sha256=('0' * 64) }) }
Assert-Throws { Assert-MigrationLedgerReport -Report $badPending -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'Pending migration hash drift at version 46.'
# 041 still pending (Agency Documents not recorded) must stop the release, as must 045 not yet recorded.
$multiple = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -le 40); pending=@($migrationFiles | Select-Object -Last 6 | ForEach-Object { [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=$archiveHashes[$_.Name] } }) }
Assert-Throws { Assert-MigrationLedgerReport -Report $multiple -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'exactly migration 046 pending'
$partial = [pscustomobject]@{ ledger='present'; applied=@($applied | Where-Object version -le 44); pending=@($migrationFiles | Select-Object -Last 2 | ForEach-Object { [pscustomobject]@{ version=[int]$_.Name.Substring(0,3); filename=$_.Name; content_sha256=$archiveHashes[$_.Name] } }) }
Assert-Throws { Assert-MigrationLedgerReport -Report $partial -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'exactly migration 046 pending'
Assert-Throws { Assert-EntitlementMigrationRecord -Report $before -ApplicationCommit ('b' * 40) -Environment staging } 'Migration 046 ledger entry'
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

# Release entry-point guards in release-entitlements-staging.ps1, read from its syntax tree.
$releasePath = Join-Path $PSScriptRoot 'release-entitlements-staging.ps1'
$parseErrors = $null
$releaseAst = [System.Management.Automation.Language.Parser]::ParseFile($releasePath, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'release-entitlements-staging.ps1 does not parse.' }
$releaseParameters = @{}
foreach ($parameter in $releaseAst.ParamBlock.Parameters) { $releaseParameters[$parameter.Name.VariablePath.UserPath] = $parameter }
foreach ($name in @('ToolingCommit', 'ApplicationCommit')) {
    $parameter = $releaseParameters[$name]
    if ($null -eq $parameter) { throw "Release parameter -$name is missing." }
    $mandatory = @($parameter.Attributes | Where-Object { $_.TypeName.Name -eq 'Parameter' -and @($_.NamedArguments | Where-Object { $_.ArgumentName -eq 'Mandatory' }).Count -eq 1 })
    if ($mandatory.Count -ne 1) { throw "Release parameter -$name must be mandatory." }
    if ($null -ne $parameter.DefaultValue) { throw "Release parameter -$name must have no default commit." }
}
# The live pre-release revision is pinned: only 187 passes, and the check runs before the image is published.
$revisionChecks = @($releaseAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -match '^\$previousTaskDefinition -notmatch ' }, $true))
if ($revisionChecks.Count -ne 1) { throw 'Expected exactly one pre-release task revision check.' }
$revisionCheck = $revisionChecks[0]
$revisionComparison = @($revisionCheck.Clauses[0].Item1.FindAll({ param($node) $node -is [System.Management.Automation.Language.BinaryExpressionAst] }, $true)) | Select-Object -First 1
$revisionPattern = [string]$revisionComparison.Right.Value
if ($revisionPattern -cne ':187$') { throw "Pre-release revision pin is '$revisionPattern', expected ':187$'." }
foreach ($revision in @(185, 186, 188, 1187)) { if ("arn:aws:ecs:us-east-1:559054714699:task-definition/tracepointstagingruntimeServiceTaskDefC2B9B4C5:$revision" -match $revisionPattern) { throw "Revision $revision passed the pre-release pin." } }
if ('arn:aws:ecs:us-east-1:559054714699:task-definition/tracepointstagingruntimeServiceTaskDefC2B9B4C5:187' -notmatch $revisionPattern) { throw 'Revision 187 failed the pre-release pin.' }
if ($revisionCheck.Clauses[0].Item2.Extent.Text -notmatch '^\{\s*throw ') { throw 'The pre-release revision check must stop the release.' }
$publishCall = $releaseAst.Extent.Text.IndexOf("'publish-tracepoint-staging-image.ps1'")
if ($publishCall -lt 0 -or $revisionCheck.Extent.StartOffset -ge $publishCall) { throw 'The pre-release revision check must run before the image is published.' }
# Only 046 may be applied, after an exact typed confirmation, and its ledger row must then carry this release.
$releaseText = $releaseAst.Extent.Text
if ($releaseText -notmatch [regex]::Escape("`$expectedPending = @('046_agency_documents_module_toggle.sql')")) { throw 'Release pending set must be exactly 046.' }
if ($releaseText -notmatch [regex]::Escape("if (`$confirmation -cne 'APPLY 046') { throw")) { throw 'Database apply must require the exact APPLY 046 confirmation.' }
if (-not $releaseText.Contains('Assert-EntitlementMigrationRecord -Report $finalStatus -ApplicationCommit $ApplicationCommit -Environment staging')) { throw 'The release must verify the 046 ledger row it wrote.' }
foreach ($earlier in @('042_default_module_entitlements', '043_range_workspace_authenticated_writes', '044_cognito_password_global_scope', '045_password_operation_resolution')) {
    if ($releaseText -match "$earlier\.sql'") { throw "The release must not list $earlier as a migration to apply." }
}

# ALB target health. Regression for the 2026-10-19 release: revision 186's target 10.40.1.151 was healthy and the
# previous task's target was draining (deregistration delay 300 s); the post-deploy check counted the draining
# target as unhealthy and rolled back a healthy release.
function New-Target([string]$Id, [string]$State) { [pscustomobject]@{ Target = [pscustomobject]@{ Id = $Id; Port = 3000 }; TargetHealth = [pscustomobject]@{ State = $State } } }
$newTask = '10.40.1.151'; $oldTask = '10.40.0.82'
$afterRolloutTargets = @((New-Target $newTask 'healthy'), (New-Target $oldTask 'draining'))
$result = Assert-StagingTargetHealth -Targets $afterRolloutTargets -DesiredCount 1 -RunningTaskAddresses @($newTask) -AfterRollout
if (($result.Active -join ',') -cne $newTask -or ($result.Draining -join ',') -cne $oldTask) { throw 'After a rollout the new healthy target must pass while the old one drains.' }
Assert-Throws { Assert-StagingTargetHealth -Targets $afterRolloutTargets -DesiredCount 1 -RunningTaskAddresses @($newTask) } 'draining before the release started'
Assert-StagingTargetHealth -Targets @((New-Target $oldTask 'healthy')) -DesiredCount 1 -RunningTaskAddresses @($oldTask) | Out-Null
# Nothing else is relaxed: the active targets must be healthy, exactly the running tasks, and as many as desired.
foreach ($state in @('initial', 'unhealthy', 'unused', 'unavailable')) {
    Assert-Throws { Assert-StagingTargetHealth -Targets @((New-Target $newTask $state), (New-Target $oldTask 'draining')) -DesiredCount 1 -RunningTaskAddresses @($newTask) -AfterRollout } 'not all healthy'
}
Assert-Throws { Assert-StagingTargetHealth -Targets @((New-Target $oldTask 'draining')) -DesiredCount 1 -RunningTaskAddresses @($newTask) -AfterRollout } '0 healthy active target(s)'
Assert-Throws { Assert-StagingTargetHealth -Targets @() -DesiredCount 1 -RunningTaskAddresses @($newTask) -AfterRollout } '0 healthy active target(s)'
Assert-Throws { Assert-StagingTargetHealth -Targets @((New-Target $newTask 'healthy'), (New-Target $oldTask 'healthy')) -DesiredCount 1 -RunningTaskAddresses @($newTask) -AfterRollout } '2 healthy active target(s)'
Assert-Throws { Assert-StagingTargetHealth -Targets @((New-Target '10.40.9.9' 'healthy'), (New-Target $oldTask 'draining')) -DesiredCount 1 -RunningTaskAddresses @($newTask) -AfterRollout } 'are not the running tasks'
Assert-Throws { Assert-StagingTargetHealth -Targets @((New-Target $newTask 'healthy'), (New-Target $oldTask 'draining')) -DesiredCount 2 -RunningTaskAddresses @($newTask, $oldTask) -AfterRollout } '1 healthy active target(s)'

# Only the post-deploy check sets draining targets aside; the pre-release check does not.
$healthCalls = @($releaseAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Assert-StagingRuntimeHealth' }, $true))
if ($healthCalls.Count -ne 2) { throw "Expected two Assert-StagingRuntimeHealth calls; found $($healthCalls.Count)." }
$deployCall = $releaseText.IndexOf("'deploy-app.ps1') -ScriptArguments @('staging','-ImageCommit'")
foreach ($call in $healthCalls) {
    $afterDeploy = $call.Extent.StartOffset -gt $deployCall
    $hasSwitch = $call.Extent.Text -match '-AfterRollout\b'
    if ($afterDeploy -ne $hasSwitch) { throw "Assert-StagingRuntimeHealth -AfterRollout must be used exactly for the post-deploy check (at offset $($call.Extent.StartOffset))." }
}
if ($releaseText -notmatch 'Assert-StagingTargetHealth -Targets') { throw 'The release health check must use Assert-StagingTargetHealth.' }

# Deploy-only redeploy over the migrated ledger: verifies 001-046 with nothing pending and never applies.
foreach ($name in @('DeployOnly', 'RecordedMigrationCommit')) { if (-not $releaseParameters.ContainsKey($name)) { throw "Release parameter -$name is missing." } }
$deployOnlyBranch = @($releaseAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -ceq '$DeployOnly' -and $node.ElseClause -and $node.ElseClause.Extent.Text.Contains("'migrate-db.ps1'") }, $true))
if ($deployOnlyBranch.Count -ne 1) { throw 'Expected one if ($DeployOnly) { ... } else { ... } around the migration steps.' }
$deployOnlyText = $deployOnlyBranch[0].Clauses[0].Item2.Extent.Text
$applyText = $deployOnlyBranch[0].ElseClause.Extent.Text
if ($deployOnlyText -match "'-Action','apply'|APPLY 04|Read-Host") { throw 'The deploy-only branch must not apply or prompt for migrations.' }
foreach ($required in @("-Expectation 'after-apply'", 'Count -ne 46','Count -ne 0', 'Assert-EntitlementMigrationRecord -Report $status -ApplicationCommit $RecordedMigrationCommit -Environment staging', 'Assert-RdsPitr')) {
    if (-not $deployOnlyText.Contains($required)) { throw "The deploy-only branch must contain: $required" }
}
if (-not $applyText.Contains("'-Action','apply'") -or -not $applyText.Contains("-cne 'APPLY 046'")) { throw 'Migration apply must remain only in the confirmed non-deploy-only branch.' }
if (@($releaseAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -ceq 'apply' -and $node.Parent.Extent.Text -match "'-Action','apply'" }, $true)).Count -ne 1) { throw 'There must be exactly one migration apply call.' }
foreach ($guard in @("if (`$DeployOnly -and -not `$RecordedMigrationCommit) { throw", "if (`$RecordedMigrationCommit -and -not `$DeployOnly) { throw", "'merge-base','--is-ancestor',`$RecordedMigrationCommit,`$ApplicationCommit")) {
    if (-not $releaseText.Contains($guard)) { throw "Missing deploy-only guard: $guard" }
}
# The ledger staging holds after this release: 001-046, 046 recorded by the release commit ('b' * 40 here). A later
# deploy-only redeploy names that commit; the ledger then has nothing left to apply.
Assert-MigrationLedgerReport -Report $after -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation after-apply | Out-Null
Assert-Throws { Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit ('f' * 40) -Environment staging } 'does not match'
Assert-Throws { Assert-MigrationLedgerReport -Report $after -MigrationFiles @($migrationFiles.FullName) -RepositoryRoot $repoRoot -MigrationCommit $testCommit -Expectation before-apply } 'exactly migration 046 pending'

# No interactive web-request prompt in the release path (seen during the 2026-10-19 redeploy).
foreach ($scriptName in @('release-entitlements-staging.ps1', 'deploy-app.ps1')) {
    $scriptAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $scriptName), [ref]$null, [ref]$null)
    $webCalls = @($scriptAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -in @('Invoke-WebRequest', 'iwr', 'curl', 'wget') }, $true))
    foreach ($call in $webCalls) { if ($call.Extent.Text -notmatch '-UseBasicParsing\b') { throw "$scriptName calls $($call.GetCommandName()) without -UseBasicParsing (line $($call.Extent.StartLineNumber))." } }
}

Write-Host 'migration release core tests passed.'
