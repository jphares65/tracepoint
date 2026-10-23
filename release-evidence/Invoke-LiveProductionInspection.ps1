#requires -Version 5.1
<#
TracePoint: guarded live production database inspection (evidence support only).

Runs exactly one approved action:
  scripts\apply-app-migrations.ps1 -Environment production -Action inspect -ImageCommit 5700011...
from a new, clean detached worktree of the agreed candidate 3329411a (a unique path
per run; no existing worktree or folder is reused or removed).

What it may change in AWS: it registers one revision of the dedicated task family
tracepoint-production-live-database-inspect and runs one Fargate task from it. That task
uses the deployed production image (5700011), the running application's least-privileged
database credential, no task role, and a pinned live host. The runner opens a READ ONLY
transaction.

What it does not do: apply migrations; use the database owner credential; change database
records; build or push an image; update, scale or redeploy the application service.
The service is snapshotted before and after; the script stops if anything differs.

Results stay in the evidence folder on this workstation. Nothing is committed or pushed.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo           = 'C:\Users\jphar\tracepoint'
$Evidence       = 'C:\Users\jphar\tracepoint-release-evidence-20261022-140702'
$ToolingCommit  = '3329411acd33d0d7f00cc3418a536caf40f0c07e'   # claude/integration-batch2-20261022
$ProductionApp  = '5700011cc9ea6cff880bcb7f697423fa7f4fd27c'   # running production commit
$ExpectedDigest = 'sha256:c5ab4e1facd4a4cd69bf1a011b156e6020c440359fa222749f638930fcfbc7c2'
$ExpectedTaskDefinition = 'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepoint-production-consolidated-aws-native-20260929:30'
$InspectFamily  = 'tracepoint-production-live-database-inspect'
$ExpectedScriptBlob = '376219ccbf32594064af624b26ed2c1803380d4a'  # scripts/apply-app-migrations.ps1 at 3329411a
$AwsProfile = 'tracepoint-production'; $Region = 'us-east-1'; $Account = '193644343389'
$Cluster = 'tracepoint-production'; $Service = 'tracepoint-production'
$Stamp   = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$OutDir  = Join-Path $Evidence "production-live-inspection-$Stamp"
# A new worktree path for every run; an existing path (any other worktree or folder) is never reused or removed.
$Tooling = Join-Path $env:TEMP ("tp-live-inspect-3329411a-$Stamp-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$CreatedWorktree = $false

function Stop-Inspection([string]$Message) { throw "STOPPED (nothing was inspected or changed after this point): $Message" }
function Invoke-AwsJson([string[]]$Arguments) {
    $prior = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $output = & aws.exe @Arguments --profile $AwsProfile --region $Region --output json 2>&1; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prior }
    if ($code -ne 0) { throw "aws $($Arguments[0]) $($Arguments[1]) failed: $(($output | ForEach-Object { "$_" }) -join ' ')" }
    return (($output | Where-Object { $_ -is [string] }) -join "`n") | ConvertFrom-Json
}
function Get-ServiceState {
    $s = (Invoke-AwsJson @('ecs','describe-services','--cluster',$Cluster,'--services',$Service)).services | Select-Object -First 1
    $arns = @((Invoke-AwsJson @('ecs','list-tasks','--cluster',$Cluster,'--service-name',$Service,'--desired-status','RUNNING')).taskArns)
    $digests = @()
    if ($arns.Count -gt 0) {
        $tasks = (Invoke-AwsJson (@('ecs','describe-tasks','--cluster',$Cluster,'--tasks') + $arns)).tasks
        $digests = @($tasks | ForEach-Object { ($_.containers | Select-Object -First 1).imageDigest } | Sort-Object -Unique)
    }
    return [pscustomobject][ordered]@{
        status = $s.status; taskDefinition = $s.taskDefinition; desiredCount = $s.desiredCount
        deployments = (@($s.deployments | Sort-Object id | ForEach-Object { "$($_.id)|$($_.status)|$($_.taskDefinition)|$($_.rolloutState)" }) -join ';')
        runningDigests = ($digests -join ',')
    }
}

# 1. Workstation prerequisites and inputs.
foreach ($tool in 'aws.exe','git.exe','node.exe') { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-Inspection "$tool is not on PATH." } }
if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) { Stop-Inspection "No git repository at $Repo." }
if (-not (Test-Path -LiteralPath $Evidence)) { Stop-Inspection "Evidence folder $Evidence does not exist." }
New-Item -ItemType Directory -Path $OutDir | Out-Null
Start-Transcript -LiteralPath (Join-Path $OutDir 'transcript.txt') | Out-Null
try {
    # 2. The exact reviewed tooling, in a clean detached worktree (the main checkout is not touched).
    & git.exe -C $Repo fetch --quiet origin claude/integration-batch2-20261022
    if ($LASTEXITCODE -ne 0) { Stop-Inspection 'git fetch failed.' }
    & git.exe -C $Repo merge-base --is-ancestor $ToolingCommit origin/claude/integration-batch2-20261022
    if ($LASTEXITCODE -ne 0) { Stop-Inspection "$ToolingCommit is not on origin/claude/integration-batch2-20261022." }
    if ((& git.exe -C $Repo cat-file -t $ProductionApp) -ne 'commit') { Stop-Inspection "Production commit $ProductionApp is not in the local repository." }
    if (Test-Path -LiteralPath $Tooling) { Stop-Inspection "The new worktree path $Tooling already exists; nothing was removed." }
    & git.exe -C $Repo worktree add --detach $Tooling $ToolingCommit | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Inspection 'Could not create the tooling worktree.' }
    $CreatedWorktree = $true
    if ((& git.exe -C $Tooling rev-parse HEAD).Trim() -ne $ToolingCommit) { Stop-Inspection 'The tooling worktree is not at the reviewed commit.' }
    if (@(& git.exe -C $Tooling status --porcelain --untracked-files=all).Count -ne 0) { Stop-Inspection 'The tooling worktree is not clean.' }
    $blob = ((& git.exe -C $Tooling ls-tree HEAD scripts/apply-app-migrations.ps1) -split '\s+')[2]
    if ($blob -ne $ExpectedScriptBlob) { Stop-Inspection "apply-app-migrations.ps1 is not the reviewed version ($blob)." }

    # 3. Identity and the production state the evidence recorded.
    $identity = Invoke-AwsJson @('sts','get-caller-identity')
    if ($identity.Account -ne $Account -or $identity.Arn -notmatch 'assumed-role/[^/]*TracePointMigrationProduction[^/]*/') { Stop-Inspection "Identity $($identity.Arn) is not the production migration role. Run: aws sso login --profile $AwsProfile" }
    $before = Get-ServiceState
    $before | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $OutDir 'service-before.json')
    if ($before.status -ne 'ACTIVE' -or $before.taskDefinition -ne $ExpectedTaskDefinition -or $before.runningDigests -ne $ExpectedDigest) {
        Stop-Inspection "Production is not in the state the evidence recorded (task definition $($before.taskDefinition), digests $($before.runningDigests)). The coordinator must re-collect evidence first."
    }
    if ($before.deployments -notmatch '\|PRIMARY\|' -or $before.deployments -match 'IN_PROGRESS') { Stop-Inspection 'A production deployment is in progress.' }
    $appImage = (Invoke-AwsJson @('ecr','describe-images','--repository-name','tracepoint-production','--image-ids',"imageTag=$ProductionApp-aws-native-production")).imageDetails | Select-Object -First 1
    if ($null -eq $appImage -or $appImage.imageDigest -ne $ExpectedDigest) { Stop-Inspection 'The production image tag for 5700011 does not resolve to the running digest.' }

    # 4. The approved inspection, and nothing else. Never pass -AuthorizeLiveDatabaseChange,
    #    -ApplicationImageDigest or -MigrationSourceCommit (they select change or release lanes).
    $failure = $null
    Push-Location -LiteralPath $Tooling
    try { $lines = & .\scripts\apply-app-migrations.ps1 -Environment production -Action inspect -ImageCommit $ProductionApp *>&1 }
    catch { $failure = $_ }
    finally { Pop-Location }
    $console = (@($lines) | ForEach-Object { "$_" }) -join "`r`n"
    Set-Content -Encoding UTF8 (Join-Path $OutDir 'inspect-console.txt') $console

    # 5. The application service must be exactly as before.
    $after = Get-ServiceState
    $after | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $OutDir 'service-after.json')
    foreach ($field in 'status','taskDefinition','desiredCount','deployments','runningDigests') {
        if ("$($before.$field)" -ne "$($after.$field)") { throw "PRODUCTION SERVICE CHANGED during inspection ($field): '$($before.$field)' -> '$($after.$field)'. Report this to the coordinator before anything else." }
    }
    if ($failure) { throw "The inspection task did not succeed: $($failure.Exception.Message) (service unchanged; see inspect-console.txt)" }

    # 6. The task that ran is the dedicated read-only inspection, with the expected image and credential.
    $taskArn = [regex]::Match($console, 'arn:aws:ecs:us-east-1:193644343389:task/[^\s;]+').Value
    if (-not $taskArn) { throw 'The inspection did not report its task ARN; see inspect-console.txt.' }
    $task = (Invoke-AwsJson @('ecs','describe-tasks','--cluster',$Cluster,'--tasks',$taskArn)).tasks | Select-Object -First 1
    $definition = (Invoke-AwsJson @('ecs','describe-task-definition','--task-definition',$task.taskDefinitionArn)).taskDefinition
    $container = $definition.containerDefinitions[0]
    $command = (@(($task.overrides.containerOverrides | Select-Object -First 1).command) -join ' ')
    $checks = [ordered]@{
        family = ($definition.family -eq $InspectFamily)
        command = ($command -eq 'scripts/run-aws-native-migrations.mjs inspect production')
        noTaskRole = (-not $definition.taskRoleArn)
        image = ($container.image -like "*@$ExpectedDigest")
        runtimeCredential = (@($container.secrets | Where-Object { $_.valueFrom -like '*:secret:tracepoint/production/final/database-runtime-*' }).Count -eq 1 -and @($container.secrets).Count -eq 1)
        pinnedHost = (@($container.environment | Where-Object { $_.name -eq 'TRACEPOINT_EXPECTED_DATABASE_HOST' }).Count -eq 1)
        exitedZero = ((($task.containers | Select-Object -First 1).exitCode) -eq 0)
    }
    [pscustomobject]$checks | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $OutDir 'inspection-task-checks.json')
    $bad = @($checks.Keys | Where-Object { -not $checks[$_] })
    if ($bad.Count) { throw "The inspection task did not match the approved shape: $($bad -join ', '). Do not use its output; report to the coordinator." }

    # 7. The inspection report from the task's own log stream (paged; kept on this workstation).
    $log = $container.logConfiguration.options
    $stream = "$($log.'awslogs-stream-prefix')/$($container.name)/$($taskArn.Split('/')[-1])"
    $messages = New-Object System.Collections.Generic.List[string]; $token = $null; $pages = 0
    do {
        $call = @('logs','get-log-events','--log-group-name',$log.'awslogs-group','--log-stream-name',$stream,'--start-from-head','--query','{m:events[].message,t:nextForwardToken}')
        if ($token) { $call += @('--next-token',$token) }
        $page = Invoke-AwsJson $call
        foreach ($m in @($page.m)) { if ($null -ne $m) { $messages.Add([string]$m) } }
        $done = (-not $page.t) -or ($page.t -eq $token); $token = $page.t; $pages++
    } until ($done -or $pages -ge 200)
    $reportPath = Join-Path $OutDir 'live-inspection-report.log'
    [IO.File]::WriteAllLines($reportPath, $messages)
    if ($messages.Count -eq 0) { throw 'The inspection log stream was empty; see inspect-console.txt.' }
    if (($messages -join "`n") -match '"applying"') { throw 'The inspection log contains an "applying" record. Report this to the coordinator immediately.' }

    $manifest = Get-ChildItem -LiteralPath $OutDir -File | ForEach-Object { [pscustomobject]@{ file = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() } }
    $manifest | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $OutDir 'manifest.json')
    Write-Host ''
    Write-Host "LIVE INSPECTION COMPLETE. Production service unchanged; task $taskArn ($InspectFamily rev $($definition.revision))."
    Write-Host "Results (local only, not committed or pushed): $OutDir"
    Write-Host 'Give live-inspection-report.log, inspection-task-checks.json and service-before/after.json to the release coordinator.'
} finally {
    # Only the worktree this run created, and never with --force: if git refuses
    # (for example the tree is not clean), it is left in place for review.
    if ($CreatedWorktree) {
        $prior = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { & git.exe -C $Repo worktree remove $Tooling 2>&1 | Out-Null; $removed = ($LASTEXITCODE -eq 0) } catch { $removed = $false } finally { $ErrorActionPreference = $prior }
        if (-not $removed -or (Test-Path -LiteralPath $Tooling)) { Write-Warning "The tooling worktree was not removed and is left at $Tooling for review." }
    }
    Stop-Transcript | Out-Null
}
