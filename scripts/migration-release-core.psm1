Set-StrictMode -Version Latest

$script:StagingAccount = '559054714699'
$script:StagingRegion = 'us-east-1'
$script:StagingRole = 'TracePointMigrationStaging'
$script:StagingReleaseBranches = @(
    'codex/aws-staging-readiness-20260902',
    'codex/aws-staging-integration-20260908',
    'codex/staging-mobile-api-release-20261007',
    'codex/demo-pd-module-visibility',
    # Staging release candidate: demo-pd + Agency Documents + production line (2026-10-18).
    'claude/staging-release-agency-documents',
    # Same candidate with the image-archive and Windows PowerShell 5.1 release fixes (2026-10-18).
    'claude/staging-rc-agency-documents-20261018'
)

function Get-ReviewedImageTag {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
        [Parameter(Mandatory)][string]$Commit
    )
    if ($Commit -notmatch '^[0-9a-f]{40}$') { throw 'Reviewed commit must be a full lowercase Git SHA.' }
    if ($Environment -eq 'staging') { return "$Commit-aws-native-staging" }
    return "$Commit-aws-native-production"
}

function Assert-ReviewedImageTag {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Environment,
        [Parameter(Mandatory)][string]$Commit,
        [Parameter(Mandatory)][string]$Tag
    )
    $expected = Get-ReviewedImageTag -Environment $Environment -Commit $Commit
    if ($Tag -cne $expected) { throw "Image tag '$Tag' does not match reviewed tag '$expected'." }
    return $expected
}

function Assert-ReleaseBranch {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Branch)
    if ($Branch -cnotin $script:StagingReleaseBranches) { throw "Refusing staging build from unapproved branch '$Branch'." }
    return $Branch
}

function Assert-StagingIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Identity)
    if ([string]$Identity.Account -cne $script:StagingAccount) { throw "Wrong AWS account '$($Identity.Account)'; staging account is $script:StagingAccount." }
    if ([string]$Identity.Arn -notmatch "^arn:aws:sts::$($script:StagingAccount):assumed-role/[^/]*$($script:StagingRole)[^/]*/[^/]+$") { throw 'AWS identity is not an assumed TracePointMigrationStaging role.' }
    return $Identity
}

function Assert-ImageDigest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Actual,
        [Parameter(Mandatory)][string]$Expected
    )
    if ($Actual -notmatch '^sha256:[0-9a-f]{64}$' -or $Expected -notmatch '^sha256:[0-9a-f]{64}$' -or $Actual -cne $Expected) {
        throw "Image digest '$Actual' does not match the reviewed digest '$Expected'."
    }
    return $Actual
}

function ConvertFrom-MigrationRunnerLog {
    [CmdletBinding()]
    param([Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Messages)
    if ($Messages.Count -eq 0) { throw 'Migration task logs are missing.' }
    $reports = [System.Collections.Generic.List[object]]::new()
    foreach ($message in $Messages) {
        $line = ([string]$message).Trim()
        if (-not $line.StartsWith('{')) { continue }
        try { $parsed = $line | ConvertFrom-Json -ErrorAction Stop }
        catch { throw 'Migration task emitted malformed JSON.' }
        if ($null -ne $parsed.PSObject.Properties['ledger']) { $reports.Add($parsed) }
    }
    if ($reports.Count -ne 1) { throw "Expected one migration ledger JSON report, found $($reports.Count)." }
    return $reports[0]
}

function Get-AwsMigrationFiles {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Directory)
    $files = @(Get-ChildItem -LiteralPath $Directory -File -Filter '*.sql' -ErrorAction Stop | Sort-Object Name)
    if ($files.Count -eq 0) { throw 'No AWS migration files were found.' }
    $versions = @{}
    foreach ($file in $files) {
        if ($file.Name -notmatch '^(?<version>[0-9]{3})_[a-z0-9_]+\.sql$') { throw "Invalid AWS migration filename '$($file.Name)'." }
        $version = [int]$Matches.version
        if ($versions.ContainsKey($version)) { throw "Duplicate AWS migration version $version." }
        $versions[$version] = $file.FullName
    }
    foreach ($expectedVersion in 1..$versions.Count) {
        if (-not $versions.ContainsKey($expectedVersion)) { throw 'AWS migration files contain a historical version gap.' }
    }
    return @($files | ForEach-Object FullName)
}

function Get-AwsMigrationArchiveHashes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit
    )
    $resolvedCommit = (& git.exe -C $RepositoryRoot rev-parse "$Commit^{commit}").Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $resolvedCommit -cne $Commit) { throw 'Migration archive commit is not an exact reviewed commit.' }

    $archivePath = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-hashes-' + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        & git.exe -C $RepositoryRoot -c core.autocrlf=true archive --format=zip "--output=$archivePath" $Commit -- database/aws
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create canonical migration source archive.' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            $hashes = @{}
            $versions = @{}
            foreach ($entry in $archive.Entries) {
                if ($entry.FullName -notlike 'database/aws/*.sql') { continue }
                if ($entry.FullName -notmatch '^database/aws/(?<name>[0-9]{3}_[a-z0-9_]+\.sql)$') { throw "Invalid AWS migration archive path '$($entry.FullName)'." }
                $name = $Matches.name
                $version = [int]$name.Substring(0,3)
                if ($versions.ContainsKey($version)) { throw "Duplicate AWS migration version $version in source archive." }
                $versions[$version] = $name
                $stream = $entry.Open()
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $hashes[$name] = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
                finally { $stream.Dispose(); $sha.Dispose() }
            }
            if ($hashes.Count -eq 0) { throw 'Canonical migration archive contains no AWS migration files.' }
            foreach ($expectedVersion in 1..$versions.Count) {
                if (-not $versions.ContainsKey($expectedVersion)) { throw 'Canonical AWS migration archive contains a historical version gap.' }
            }
            return $hashes
        } finally { $archive.Dispose() }
    } finally { if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force } }
}

function Assert-MigrationLedgerReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Report,
        [Parameter(Mandatory)][string[]]$MigrationFiles,
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$MigrationCommit,
        [ValidateSet('before-apply','after-apply','status')][string]$Expectation = 'status'
    )
    if ([string]$Report.ledger -cne 'present' -or $null -eq $Report.applied -or $null -eq $Report.pending) {
        throw 'Migration ledger is absent or the status report is incomplete.'
    }
    $filesByVersion = @{}
    $hashesByVersion = @{}
    foreach ($file in $MigrationFiles) {
        $name = [IO.Path]::GetFileName($file)
        if ($name -notmatch '^(?<version>[0-9]{3})_[a-z0-9_]+\.sql$') { throw "Invalid AWS migration filename '$name'." }
        $version = [int]$Matches.version
        if ($filesByVersion.ContainsKey($version)) { throw "Duplicate AWS migration version $version." }
        $filesByVersion[$version] = $name
    }
    $expectedVersions = @(1..$filesByVersion.Count)
    foreach ($expectedVersion in $expectedVersions) {
        if (-not $filesByVersion.ContainsKey($expectedVersion)) { throw 'AWS migration files contain a historical version gap.' }
    }
    $archiveHashes = Get-AwsMigrationArchiveHashes -RepositoryRoot $RepositoryRoot -Commit $MigrationCommit
    $localNames = @($filesByVersion.Values | Sort-Object)
    $archiveNames = @($archiveHashes.Keys | Sort-Object)
    if (($localNames -join "`n") -cne ($archiveNames -join "`n")) { throw 'Local AWS migration filenames do not match the reviewed source archive.' }
    foreach ($version in $expectedVersions) { $hashesByVersion[$version] = $archiveHashes[$filesByVersion[$version]] }

    $appliedByVersion = @{}
    foreach ($row in @($Report.applied)) {
        $version = 0
        if (-not [int]::TryParse([string]$row.version, [ref]$version) -or $appliedByVersion.ContainsKey($version)) { throw 'Migration ledger has a duplicate or invalid applied version.' }
        if (-not $filesByVersion.ContainsKey($version) -or [string]$row.filename -cne $filesByVersion[$version]) { throw "Migration ledger filename drift at version $version." }
        if ([string]$row.content_sha256 -notmatch '^[0-9a-f]{64}$') { throw "Migration ledger hash is invalid at version $version." }
        if ([string]$row.content_sha256 -cne $hashesByVersion[$version]) { throw "Migration ledger content drift at version $version." }
        $appliedByVersion[$version] = $row
    }
    $pendingByVersion = @{}
    foreach ($row in @($Report.pending)) {
        $version = 0
        if (-not [int]::TryParse([string]$row.version, [ref]$version) -or $pendingByVersion.ContainsKey($version)) { throw 'Migration report has a duplicate or invalid pending version.' }
        if (-not $filesByVersion.ContainsKey($version) -or [string]$row.filename -cne $filesByVersion[$version]) { throw "Pending migration filename drift at version $version." }
        if ([string]$row.content_sha256 -notmatch '^[0-9a-f]{64}$') { throw "Pending migration hash is invalid at version $version." }
        if ([string]$row.content_sha256 -cne $hashesByVersion[$version]) { throw "Pending migration hash drift at version $version." }
        $pendingByVersion[$version] = $row
    }
    foreach ($version in $expectedVersions) {
        if ($appliedByVersion.ContainsKey($version) -eq $pendingByVersion.ContainsKey($version)) { throw "Migration ledger has a gap or overlap at version $version." }
    }
    if ($filesByVersion.Count -ne 48 -or $filesByVersion[38] -cne '038_agency_documents_template_builder.sql' -or $filesByVersion[42] -cne '042_default_module_entitlements.sql' -or $filesByVersion[43] -cne '043_range_workspace_authenticated_writes.sql' -or $filesByVersion[44] -cne '044_cognito_password_global_scope.sql' -or $filesByVersion[45] -cne '045_password_operation_resolution.sql' -or $filesByVersion[46] -cne '046_agency_documents_module_toggle.sql' -or $filesByVersion[47] -cne '047_fleet_inventory_feature_catalog.sql' -or $filesByVersion[48] -cne '048_activate_fleet_inventory_catalog.sql') { throw 'Reviewed staging release requires the AWS migration set through migration 048, preserving the Agency Documents lineage at 038-041.' }
    # Staging records 001-047 (047 applied by eb637823 on 2026-10-21); this release applies only 048.
    if ($Expectation -eq 'before-apply' -and ($pendingByVersion.Count -ne 1 -or -not $pendingByVersion.ContainsKey(48))) { throw 'Apply requires exactly migration 048 pending.' }
    if ($Expectation -eq 'after-apply' -and $pendingByVersion.Count -ne 0) { throw 'Post-apply ledger still has pending migrations.' }
    return $Report
}

function Assert-EntitlementMigrationRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Report,
        [Parameter(Mandatory)][string]$ApplicationCommit,
        [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
        # The migrations one release applied: 048 by default (this release); 047 by eb637823; 046 by 75499335; 043-045 by e3b06e6a.
        [ValidateSet(43, 44, 45, 46, 47, 48)][int[]]$Versions = @(48)
    )
    # Every migration a release applies must be recorded by its commit, in this environment, as an apply.
    # A list of pairs, not an [ordered] dictionary: an ordered dictionary treats an [int] key as a position.
    # 042 was recorded by an earlier staging release (its content is still verified by Assert-MigrationLedgerReport).
    $known = @(@(43, '043_range_workspace_authenticated_writes.sql'), @(44, '044_cognito_password_global_scope.sql'), @(45, '045_password_operation_resolution.sql'), @(46, '046_agency_documents_module_toggle.sql'), @(47, '047_fleet_inventory_feature_catalog.sql'), @(48, '048_activate_fleet_inventory_catalog.sql'))
    # Built with a loop: piping the pairs would unroll a single selected pair into its two elements.
    $expected = [System.Collections.Generic.List[object]]::new()
    foreach ($pair in $known) { if ($Versions -contains [int]$pair[0]) { $expected.Add($pair) } }
    if ($expected.Count -ne @($Versions | Select-Object -Unique).Count) { throw 'Migration record check received an unknown or duplicate version.' }
    $records = @()
    foreach ($pair in $expected) {
        $version = [int]$pair[0]; $filename = [string]$pair[1]
        $record = @($Report.applied | Where-Object { [int]$_.version -eq $version }) | Select-Object -First 1
        if ($null -eq $record -or [string]$record.filename -cne $filename -or [string]$record.application_git_sha -cne $ApplicationCommit -or [string]$record.environment -cne $Environment -or [string]$record.application_context -cne 'apply' -or $record.is_baseline -ne $false) {
            throw "Migration $('{0:d3}' -f $version) ledger entry does not match this application commit and release environment."
        }
        $records += $record
    }
    return $records[0]
}

function Assert-StagingTargetHealth {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Targets,
        [Parameter(Mandatory)][ValidateRange(1, 100)][int]$DesiredCount,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$RunningTaskAddresses,
        [switch]$AfterRollout
    )
    # Before a release every registered target must be healthy. After a rolling deployment the previous task's
    # target stays 'draining' for the target group's deregistration delay (300 s on staging): ECS has already
    # stopped routing to it and it is not part of the new release, so only then are draining targets set aside,
    # the same rule deploy-app.ps1 applies. A draining target must not be a running task. Every other target
    # must be healthy, and they must be exactly the running tasks (one per task, none missing, none extra).
    $draining = @($Targets | Where-Object { [string]$_.TargetHealth.State -ceq 'draining' })
    $active = @($Targets | Where-Object { [string]$_.TargetHealth.State -cne 'draining' })
    if (-not $AfterRollout -and $draining.Count) { throw 'Staging ALB targets are not all healthy: a target is draining before the release started.' }
    if (@($active | Where-Object { [string]$_.TargetHealth.State -cne 'healthy' }).Count) { throw "Staging ALB targets are not all healthy: $(@($active | ForEach-Object { "$($_.Target.Id)=$($_.TargetHealth.State)" }) -join ', ')." }
    if ($active.Count -ne $DesiredCount) { throw "Staging ALB has $($active.Count) healthy active target(s); the service desires $DesiredCount." }
    $activeIds = @($active | ForEach-Object { [string]$_.Target.Id } | Sort-Object)
    $taskIds = @($RunningTaskAddresses | Sort-Object)
    if (($activeIds -join ',') -cne ($taskIds -join ',')) { throw "Staging ALB active targets ($($activeIds -join ', ')) are not the running tasks ($($taskIds -join ', '))." }
    if (@($draining | Where-Object { $taskIds -ccontains [string]$_.Target.Id }).Count) { throw 'A running staging task is draining from the ALB.' }
    return [pscustomobject]@{ Active = $activeIds; Draining = @($draining | ForEach-Object { [string]$_.Target.Id }) }
}

Export-ModuleMember -Function Get-ReviewedImageTag,Assert-ReviewedImageTag,Assert-ReleaseBranch,Assert-StagingIdentity,Assert-ImageDigest,ConvertFrom-MigrationRunnerLog,Get-AwsMigrationFiles,Get-AwsMigrationArchiveHashes,Assert-MigrationLedgerReport,Assert-EntitlementMigrationRecord,Assert-StagingTargetHealth
