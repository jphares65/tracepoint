#requires -Version 5.1
<#
TracePoint release evidence: gates G1 (migration ledgers), G2 (deployed image and
source provenance) and the input for G7 (rollback compatibility).

READ-ONLY. The script calls only:
  sts get-caller-identity
  ecs describe-services / describe-task-definition / list-tasks / describe-tasks / list-task-definitions
  ecr describe-images
  codebuild list-builds-for-project / batch-get-builds
  logs filter-log-events
  s3api get-object        (downloads the exact source archive that built the deployed image)
It creates, registers, starts, uploads, tags and changes nothing. It never reads
a secret value and never connects to a database.

The migration ledger is read from the runner's own output in CloudWatch:
every run of scripts/run-aws-native-migrations.mjs (status, baseline,
reconcile, apply) prints the full ledger report as one JSON line
(applied[] with version, filename, content_sha256, applied_at,
application_git_sha, is_baseline; pending[]; latestAppliedVersion). The most
recent such line is the ledger as of the last runner execution.

Usage (Windows PowerShell 5.1, after aws sso login for both profiles):
  aws sso login --profile tracepoint-member-staging
  aws sso login --profile tracepoint-production
  powershell -ExecutionPolicy Bypass -File .\Collect-ReleaseEvidence.ps1

Output: a folder under %USERPROFILE% with, per environment, summary JSON, the
full task definition (kept local), and the deployed source archive. The file
release-evidence-summary.json contains no secrets or environment variable
values and is the one to share.
#>
[CmdletBinding()]
param(
    [string]$OutputRoot = (Join-Path $env:USERPROFILE ('tracepoint-release-evidence-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))),
    [datetime]$LedgerSince = [datetime]'2026-06-01',
    [int]$MaxBuildsToSearch = 400
)
# No Set-StrictMode: AWS responses omit optional properties, which strict mode would turn into errors.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$region = 'us-east-1'
$environments = [ordered]@{
    staging = @{
        Account = '559054714699'; Profile = 'tracepoint-member-staging'
        Cluster = 'tracepoint-staging'; Service = 'tracepoint-staging'; Repository = 'tracepoint-staging'
        Build = 'tracepoint-staging-image-build'
        Bucket = 'tracepoint-staging-build-source-559054714699'; Key = 'source/tracepoint-staging-source.zip'
        MigrationFamily = 'tracepoint-staging-database-bootstrap'
    }
    production = @{
        Account = '193644343389'; Profile = 'tracepoint-production'
        Cluster = 'tracepoint-production'; Service = 'tracepoint-production'; Repository = 'tracepoint-production'
        Build = 'tracepoint-production-aws-native-image-build'
        Bucket = 'tracepoint-production-aws-native-build-source-193644343389'; Key = 'source/tracepoint-production-aws-native-source.zip'
        MigrationFamily = $null   # production migration tasks reuse the service task family
    }
}

function Invoke-AwsJson {
    param([Parameter(Mandatory)][hashtable]$Env, [Parameter(Mandatory)][string[]]$Arguments)
    $prior = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $output = & aws.exe @Arguments --profile $Env.Profile --region $region --output json 2>&1; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prior }
    if ($code -ne 0) { throw "aws $($Arguments[0]) $($Arguments[1]) failed: $($output -join ' ')" }
    $text = ($output | Where-Object { $_ -is [string] }) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return $text | ConvertFrom-Json
}

function Get-LogGroup($TaskDefinition) {
    $log = $TaskDefinition.containerDefinitions[0].logConfiguration
    if ($null -eq $log -or $log.logDriver -ne 'awslogs') { return $null }
    return $log.options.'awslogs-group'
}

function Get-LedgerEvents {
    param([hashtable]$Env, [string]$LogGroup)
    if (-not $LogGroup) { return @() }
    $since = [int64](([datetimeoffset]$LedgerSince).ToUnixTimeMilliseconds())
    $result = Invoke-AwsJson $Env @('logs', 'filter-log-events', '--log-group-name', $LogGroup,
        '--start-time', "$since", '--filter-pattern', 'latestAppliedVersion',
        '--query', 'events[].{t:timestamp,s:logStreamName,m:message}')
    $events = @()
    foreach ($event in @($result)) {
        if ($null -eq $event) { continue }
        $parsed = $null
        try { $parsed = $event.m | ConvertFrom-Json } catch { continue }
        if ($null -eq $parsed -or $null -eq $parsed.PSObject.Properties['latestAppliedVersion']) { continue }
        $events += [pscustomobject]@{
            at = ([datetimeoffset]::FromUnixTimeMilliseconds([int64]$event.t)).UtcDateTime.ToString('o')
            logGroup = $LogGroup; logStream = $event.s
            ledger = $parsed.ledger; latestAppliedVersion = $parsed.latestAppliedVersion
            applied = @($parsed.applied | ForEach-Object { [pscustomobject]@{
                version = $_.version; filename = $_.filename; content_sha256 = $_.content_sha256
                applied_at = $_.applied_at; application_git_sha = $_.application_git_sha
                environment = $_.environment; application_context = $_.application_context; is_baseline = $_.is_baseline } })
            pending = @($parsed.pending | ForEach-Object { [pscustomobject]@{ version = $_.version; filename = $_.filename; content_sha256 = $_.content_sha256 } })
        }
    }
    return $events
}

function Get-ZipMigrationHashes([string]$ZipPath) {
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $rows = @()
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -notmatch '^database/aws/(\d{3}_[a-z0-9_]+\.sql)$') { continue }
            $stream = $entry.Open()
            try { $bytes = New-Object byte[] $entry.Length; $read = 0; while ($read -lt $bytes.Length) { $n = $stream.Read($bytes, $read, $bytes.Length - $read); if ($n -le 0) { break }; $read += $n } }
            finally { $stream.Dispose() }
            $crlf = 0; for ($i = 0; $i -lt $bytes.Length; $i++) { if ($bytes[$i] -eq 13) { $crlf++ } }
            $rows += [pscustomobject]@{
                filename = $Matches[1]
                sha256 = ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
                bytes = $bytes.Length; carriageReturns = $crlf }
        }
        return @($rows | Sort-Object filename)
    } finally { $sha.Dispose(); $zip.Dispose() }
}

function Get-ZipSensitiveFindings([string]$ZipPath) {
    # Paths and rule names only; matched values are never written out.
    $nameRules = [ordered]@{
        'dotenv file' = '(^|/)\.env(\.[^/]*)?$'; 'private key or keystore file' = '\.(pem|key|p12|pfx|jks|keystore)$'
        'SSH key file' = '(^|/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$'; 'npm credentials file' = '(^|/)\.npmrc$'
        'credentials file' = '(^|/)(credentials|\.aws/config|\.git-credentials)$'; 'secrets file' = '(^|/)[^/]*secrets?[^/]*\.(json|ya?ml|env|txt)$'
        'terraform variables' = '\.tfvars(\.json)?$'
    }
    $contentRules = [ordered]@{
        'AWS access key id' = '\b(AKIA|ASIA)[0-9A-Z]{16}\b'; 'private key block' = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
        'aws_secret_access_key assignment' = '(?i)aws_secret_access_key\s*[=:]'; 'JSON web token' = '\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.'
        'GitHub token' = '\bgh[pousr]_[A-Za-z0-9]{36,}\b'; 'Slack token' = '\bxox[abprs]-[0-9A-Za-z-]{10,}'
        'Stripe live key' = '\b(sk|rk)_live_[0-9A-Za-z]{16,}'; 'connection string with password' = '(?i)\b(postgres(ql)?|mysql|mongodb(\+srv)?)://[^:/\s]+:[^@/\s]+@'
        'quoted secret-like assignment' = '(?i)(password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)["'']?\s*[:=]\s*["''][^"''\s]{12,}["'']'
    }
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $findings = @()
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            foreach ($rule in $nameRules.Keys) { if ($entry.FullName -match $nameRules[$rule]) { $findings += [pscustomobject]@{ path = $entry.FullName; line = $null; rule = $rule } } }
            if ($entry.Length -gt 2MB -or $entry.FullName -match '\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz)$') { continue }
            $reader = New-Object IO.StreamReader($entry.Open())
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $lines = $text -split "`n"
            for ($i = 0; $i -lt $lines.Count; $i++) {
                foreach ($rule in $contentRules.Keys) {
                    if ($lines[$i] -match $contentRules[$rule]) { $findings += [pscustomobject]@{ path = $entry.FullName; line = $i + 1; rule = $rule } }
                }
            }
        }
        return @($findings)
    } finally { $zip.Dispose() }
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$autocrlf = (& git.exe config --get core.autocrlf 2>$null)
$summary = [ordered]@{
    collectedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    collector = 'release-evidence/Collect-ReleaseEvidence.ps1 (read-only)'
    workstationGitCoreAutocrlf = $(if ($autocrlf) { "$autocrlf" } else { 'unset' })
    environments = [ordered]@{}
}

foreach ($name in $environments.Keys) {
    $e = $environments[$name]
    $dir = Join-Path $OutputRoot $name
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host "== $name"
    $record = [ordered]@{}
    try {
        $identity = Invoke-AwsJson $e @('sts', 'get-caller-identity')
        if ($identity.Account -ne $e.Account) { throw "Profile $($e.Profile) is account $($identity.Account), expected $($e.Account)." }
        $record.identity = [ordered]@{ account = $identity.Account; arn = $identity.Arn }

        # G2: the service, its task definition and the image it runs.
        $service = (Invoke-AwsJson $e @('ecs', 'describe-services', '--cluster', $e.Cluster, '--services', $e.Service)).services | Select-Object -First 1
        $record.service = [ordered]@{
            status = $service.status; taskDefinition = $service.taskDefinition
            desired = $service.desiredCount; running = $service.runningCount; pending = $service.pendingCount
            deployments = @($service.deployments | ForEach-Object { [ordered]@{ status = $_.status; taskDefinition = $_.taskDefinition; rolloutState = $_.rolloutState; createdAt = $_.createdAt; updatedAt = $_.updatedAt; running = $_.runningCount } })
        }
        $taskDefinition = (Invoke-AwsJson $e @('ecs', 'describe-task-definition', '--task-definition', $service.taskDefinition)).taskDefinition
        $taskDefinition | ConvertTo-Json -Depth 50 | Set-Content -Encoding UTF8 (Join-Path $dir 'service-task-definition.local-only.json')
        $container = $taskDefinition.containerDefinitions[0]
        $deploymentVersion = @($container.environment | Where-Object { $_.name -eq 'DEPLOYMENT_VERSION' } | ForEach-Object { $_.value }) | Select-Object -First 1
        $record.taskDefinition = [ordered]@{
            arn = $taskDefinition.taskDefinitionArn; family = $taskDefinition.family; revision = $taskDefinition.revision
            registeredAt = $taskDefinition.registeredAt; image = $container.image
            deploymentVersion = $deploymentVersion; logGroup = (Get-LogGroup $taskDefinition)
        }
        $runtimeMode = @($container.environment | Where-Object { $_.name -eq 'TRACEPOINT_RUNTIME_PROVIDER_MODE' } | ForEach-Object { $_.value }) | Select-Object -First 1
        $record.taskDefinition.runtimeProviderMode = $runtimeMode
        $taskArns = (Invoke-AwsJson $e @('ecs', 'list-tasks', '--cluster', $e.Cluster, '--service-name', $e.Service, '--desired-status', 'RUNNING')).taskArns
        $running = @()
        if (@($taskArns).Count -gt 0) {
            $tasks = (Invoke-AwsJson $e (@('ecs', 'describe-tasks', '--cluster', $e.Cluster, '--tasks') + @($taskArns))).tasks
            $running = @($tasks | ForEach-Object { [ordered]@{ task = $_.taskArn; taskDefinition = $_.taskDefinitionArn; lastStatus = $_.lastStatus; health = $_.healthStatus; image = ($_.containers | Select-Object -First 1).image; imageDigest = ($_.containers | Select-Object -First 1).imageDigest; startedAt = $_.startedAt } })
        }
        $record.runningTasks = $running

        # The image actually running. A task definition may pin a digest
        # (repo@sha256:...) or name a tag (repo:tag); a tag can move after the
        # tasks started, so the running tasks' reported digest is authoritative.
        $definitionDigest = if ($container.image -match '@(sha256:[0-9a-f]{64})$') { $Matches[1] } else { $null }
        $definitionTag = if (-not $definitionDigest -and $container.image -match ':([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$') { $Matches[1] } else { $null }
        $currentRevisionDigests = @($running | Where-Object { $_.taskDefinition -eq $service.taskDefinition -and $_.imageDigest } | ForEach-Object { $_.imageDigest } | Select-Object -Unique)
        $allRunningDigests = @($running | Where-Object { $_.imageDigest } | ForEach-Object { $_.imageDigest } | Select-Object -Unique)
        $digest = $null; $digestSource = $null
        if ($currentRevisionDigests.Count -eq 1) { $digest = $currentRevisionDigests[0]; $digestSource = 'running tasks (current revision)' }
        elseif ($definitionDigest) { $digest = $definitionDigest; $digestSource = 'task definition (pinned)' }
        $tagDigest = $null
        if ($definitionTag) {
            try { $tagDigest = ((Invoke-AwsJson $e @('ecr', 'describe-images', '--repository-name', $e.Repository, '--image-ids', "imageTag=$definitionTag")).imageDetails | Select-Object -First 1).imageDigest } catch { $tagDigest = $null }
            if (-not $digest -and $tagDigest) { $digest = $tagDigest; $digestSource = 'ECR tag lookup (no running task reported a digest)' }
        }
        $problems = @()
        if ($currentRevisionDigests.Count -gt 1) { $problems += 'Running tasks of the current revision report different digests.' }
        if ($allRunningDigests.Count -gt $currentRevisionDigests.Count) { $problems += 'Tasks of another revision are still running (deployment in progress?).' }
        if ($definitionDigest -and $digest -and $definitionDigest -ne $digest) { $problems += 'The pinned task-definition digest differs from the running digest.' }
        if ($tagDigest -and $digest -and $tagDigest -ne $digest) { $problems += "Tag '$definitionTag' now points to a different digest than the running tasks (the tag moved)." }
        if (-not $digest) { $problems += 'No image digest could be resolved.' }
        $record.imageResolution = [ordered]@{
            taskDefinitionImage = $container.image; taskDefinitionDigest = $definitionDigest; taskDefinitionTag = $definitionTag
            tagCurrentlyPointsTo = $tagDigest; currentRevisionRunningDigests = $currentRevisionDigests; allRunningDigests = $allRunningDigests
            resolvedDigest = $digest; source = $digestSource; consistent = ($problems.Count -eq 0); problems = $problems
        }
        $imageTags = @()
        if ($digest) {
            $image = (Invoke-AwsJson $e @('ecr', 'describe-images', '--repository-name', $e.Repository, '--image-ids', "imageDigest=$digest")).imageDetails | Select-Object -First 1
            $imageTags = @($image.imageTags)
            $record.image = [ordered]@{ digest = $digest; tags = $imageTags; pushedAt = $image.imagePushedAt; scan = $image.imageScanStatus.status }
        }
        $appTag = @($imageTags | Where-Object { $_ -match '^[0-9a-f]{40}-aws-native-' }) | Select-Object -First 1
        $record.deployedCommitFromImageTag = $(if ($appTag) { $appTag.Substring(0, 40) } else { $null })

        # G2: the CodeBuild build that produced that tag, and its exact source archive.
        $ids = @()
        $next = $null
        do {
            $arguments = @('codebuild', 'list-builds-for-project', '--project-name', $e.Build, '--sort-order', 'DESCENDING')
            if ($next) { $arguments += @('--next-token', $next) }
            $page = Invoke-AwsJson $e $arguments
            $ids += @($page.ids)
            $next = if ($null -ne $page.PSObject.Properties['nextToken']) { $page.nextToken } else { $null }
        } while ($next -and $ids.Count -lt $MaxBuildsToSearch)
        $build = $null
        for ($i = 0; $i -lt $ids.Count -and -not $build; $i += 100) {
            $batch = $ids[$i..([Math]::Min($i + 99, $ids.Count - 1))]
            $builds = (Invoke-AwsJson $e (@('codebuild', 'batch-get-builds', '--query', 'builds[].{id:id,status:buildStatus,start:startTime,end:endTime,sourceVersion:sourceVersion,resolved:resolvedSourceVersion,vars:environment.environmentVariables}', '--ids') + $batch))
            foreach ($b in @($builds)) {
                $vars = @{}; foreach ($v in @($b.vars | Where-Object { $_ })) { if ($v.name -in @('IMAGE_TAG', 'SOURCE_COMMIT', 'TRACEPOINT_ARTIFACT_TYPE')) { $vars[$v.name] = $v.value } }
                if ($appTag -and $vars['IMAGE_TAG'] -eq $appTag) {
                    $build = [ordered]@{ id = $b.id; status = $b.status; start = $b.start; end = $b.end; sourceVersion = $b.sourceVersion; resolvedSourceVersion = $b.resolved
                        imageTag = $vars['IMAGE_TAG']; sourceCommit = $vars['SOURCE_COMMIT']; artifactType = $vars['TRACEPOINT_ARTIFACT_TYPE'] }
                    break
                }
            }
        }
        $record.build = $build
        if ($build -and $build.sourceVersion) {
            $zipPath = Join-Path $dir ("deployed-source-$($build.sourceCommit).zip")
            $null = Invoke-AwsJson $e @('s3api', 'get-object', '--bucket', $e.Bucket, '--key', $e.Key, '--version-id', $build.sourceVersion, '--expected-bucket-owner', $e.Account, $zipPath)
            $record.deployedSource = [ordered]@{
                bucket = $e.Bucket; key = $e.Key; versionId = $build.sourceVersion
                file = (Split-Path -Leaf $zipPath); sha256 = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLowerInvariant()
                migrations = (Get-ZipMigrationHashes $zipPath)
            }
            # Review every finding before the archive is published anywhere (README section 2).
            $findings = @(Get-ZipSensitiveFindings $zipPath)
            $record.sensitiveFileReview = [ordered]@{
                required = $true; findingCount = $findings.Count
                findings = @($findings | Select-Object -First 200)
                note = 'Paths, line numbers and rule names only. A clean result is not proof of no secrets; review the archive before publishing it.'
            }
            $local = & git.exe cat-file -t $build.sourceCommit 2>$null
            $record.deployedCommitAvailableLocally = ($local -eq 'commit')
        }

        # G1: the ledger, from every runner execution's report since $LedgerSince.
        $groups = @($record.taskDefinition.logGroup)
        if ($e.MigrationFamily) {
            $migrationDefinition = (Invoke-AwsJson $e @('ecs', 'describe-task-definition', '--task-definition', $e.MigrationFamily)).taskDefinition
            $groups += (Get-LogGroup $migrationDefinition)
            $record.migrationTaskDefinitions = @((Invoke-AwsJson $e @('ecs', 'list-task-definitions', '--family-prefix', $e.MigrationFamily, '--sort', 'DESC', '--max-items', '20')).taskDefinitionArns)
        }
        $migrationImages = (Invoke-AwsJson $e @('ecr', 'describe-images', '--repository-name', $e.Repository, '--filter', 'tagStatus=TAGGED', '--query', 'imageDetails[].{tags:imageTags,digest:imageDigest,pushed:imagePushedAt}'))
        $record.migrationImages = @($migrationImages | Where-Object { @($_.tags | Where-Object { $_ -like 'migration-*' }).Count -gt 0 } | Sort-Object pushed -Descending | Select-Object -First 15)
        $ledgerEvents = @()
        foreach ($group in ($groups | Where-Object { $_ } | Select-Object -Unique)) { $ledgerEvents += @(Get-LedgerEvents $e $group) }
        $ledgerEvents = @($ledgerEvents | Sort-Object at)
        $record.ledgerRuns = @($ledgerEvents | ForEach-Object { [ordered]@{ at = $_.at; logStream = $_.logStream; latestAppliedVersion = $_.latestAppliedVersion; appliedCount = @($_.applied).Count; pendingCount = @($_.pending).Count } })
        $record.latestLedger = $(if ($ledgerEvents.Count) { $ledgerEvents[-1] } else { $null })
        $record.ledgerEvidenceStatus = 'HISTORICAL: the ledger as the migration runner reported it at latestLedger.at. It is not the current database state until verified through the approved pre-deployment procedure (migrate-db.ps1 status).'
        if (-not $ledgerEvents.Count) { $record.ledgerNote = 'No runner report found in the searched log groups since ' + $LedgerSince.ToString('yyyy-MM-dd') + '.' }
    } catch {
        $record.error = $_.Exception.Message
        Write-Warning "$name : $($_.Exception.Message)"
    }
    $record | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 (Join-Path $dir 'summary.json')
    $summary.environments[$name] = $record
}

$summaryPath = Join-Path $OutputRoot 'release-evidence-summary.json'
$summary | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $summaryPath
Write-Host ''
Write-Host "Evidence written to $OutputRoot"
Write-Host "Share: $summaryPath and the deployed-source-*.zip files (staging\, production\)."
Write-Host 'Keep local: *.local-only.json (full task definitions include environment variable names and values).'
