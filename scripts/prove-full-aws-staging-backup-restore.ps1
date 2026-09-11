[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][ValidatePattern('^tracepoint-staging-restore-[a-z0-9-]{8,40}$')][string]$TargetIdentifier,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{7,159}$')][string]$AuthorizationReference,
    [Parameter(Mandatory)][string]$EvidenceOutputPath,
    [ValidateRange(15, 180)][int]$BackupTimeoutMinutes = 90,
    [ValidateRange(30, 240)][int]$RestoreTimeoutMinutes = 120,
    [switch]$Execute,
    [switch]$Cleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$account = '559054714699'
$region = 'us-east-1'
$databaseIdentifier = 'tracepoint-staging-full-aws'
$vaultName = 'tracepoint-staging'
$backupPlanName = 'tracepoint-staging'
$backupStackName = 'tracepoint-staging-backup'
$modelPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path 'docs/aws-native-staging-cost-model-20260910.json'

function Invoke-AwsJson {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $result = & aws.exe @Arguments --region $region --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "AWS metadata request failed: $($Arguments[0..1] -join ' ')." }
    return (($result -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Wait-BackupJob {
    param([Parameter(Mandatory)][string]$JobId, [Parameter(Mandatory)][DateTime]$Deadline)
    do {
        $job = Invoke-AwsJson @('backup', 'describe-backup-job', '--backup-job-id', $JobId)
        if ($job.State -eq 'COMPLETED') { return $job }
        if ($job.State -notin @('CREATED', 'PENDING', 'RUNNING')) { throw "Staging backup job ended in $($job.State)." }
        if ([DateTime]::UtcNow -ge $Deadline) { throw 'Staging backup job exceeded the bounded wait.' }
        Start-Sleep -Seconds 20
    } while ($true)
}

function Wait-RestoreJob {
    param([Parameter(Mandatory)][string]$JobId, [Parameter(Mandatory)][DateTime]$Deadline)
    do {
        $job = Invoke-AwsJson @('backup', 'describe-restore-job', '--restore-job-id', $JobId)
        if ($job.Status -eq 'COMPLETED') { return $job }
        if ($job.Status -notin @('PENDING', 'RUNNING')) { throw "Staging restore job ended in $($job.Status)." }
        if ([DateTime]::UtcNow -ge $Deadline) { throw 'Staging restore job exceeded the bounded wait.' }
        Start-Sleep -Seconds 20
    } while ($true)
}

function Wait-DatabaseDeleted {
    param([Parameter(Mandatory)][string]$Identifier, [Parameter(Mandatory)][DateTime]$Deadline)
    do {
        $output = & aws.exe rds describe-db-instances --db-instance-identifier $Identifier --region $region --output json 2>&1
        if ($LASTEXITCODE -ne 0) {
            if (($output -join [Environment]::NewLine) -match 'DBInstanceNotFound') { return }
            throw 'Disposable restore deletion status could not be verified.'
        }
        if ([DateTime]::UtcNow -ge $Deadline) { throw 'Disposable restore deletion exceeded the bounded wait.' }
        Start-Sleep -Seconds 20
    } while ($true)
}

$parent = Split-Path -Parent $EvidenceOutputPath
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Evidence output directory must already exist.' }
if (Test-Path -LiteralPath $EvidenceOutputPath) { throw 'Evidence output path must not already exist.' }

$model = Get-Content -Raw -LiteralPath $modelPath | ConvertFrom-Json
$projectedCents = ($model.componentsCents.PSObject.Properties.Value | Measure-Object -Sum).Sum
if ($projectedCents -ne [int]$model.projectedTotalCents -or [int]$model.ceilingCents -ne 12500 -or
    $model.withinApprovedCeiling -ne $true -or $projectedCents -gt 12500) {
    throw 'The reviewed full-AWS staging cost model does not satisfy the authorized 125 USD ceiling.'
}

Assert-TracePointStagingIdentity | Out-Null
$budget = Invoke-AwsJson @('budgets', 'describe-budget', '--account-id', $account, '--budget-name', 'tracepoint-staging-monthly-125')
if ([decimal]$budget.Budget.BudgetLimit.Amount -ne 125 -or $budget.Budget.BudgetLimit.Unit -ne 'USD') { throw 'The exact 125 USD staging budget is required.' }

$service = Invoke-AwsJson @('ecs', 'describe-services', '--cluster', 'tracepoint-staging', '--services', 'tracepoint-staging')
if (@($service.services).Count -ne 1 -or $service.services[0].status -ne 'ACTIVE' -or
    $service.services[0].desiredCount -ne 1 -or $service.services[0].runningCount -ne 1 -or $service.services[0].pendingCount -ne 0) {
    throw 'The AWS-native staging service is not at its settled one-task boundary.'
}
$image = Invoke-AwsJson @('ecr', 'describe-images', '--repository-name', 'tracepoint-staging', '--image-ids', "imageTag=$SourceCommit-aws-native")
$imageDigest = [string]$image.imageDetails[0].imageDigest
$taskDefinition = Invoke-AwsJson @('ecs', 'describe-task-definition', '--task-definition', $service.services[0].taskDefinition)
if (@($image.imageDetails).Count -ne 1 -or $imageDigest -notmatch '^sha256:[0-9a-f]{64}$' -or
    @($taskDefinition.taskDefinition.containerDefinitions).Count -ne 1 -or
    $taskDefinition.taskDefinition.containerDefinitions[0].image -ne "$account.dkr.ecr.$region.amazonaws.com/tracepoint-staging@$imageDigest") {
    throw 'The deployed AWS-native staging task does not match SourceCommit.'
}

$source = Invoke-AwsJson @('rds', 'describe-db-instances', '--db-instance-identifier', $databaseIdentifier)
if (@($source.DBInstances).Count -ne 1) { throw 'The exact AWS-native staging database was not found.' }
$sourceDb = $source.DBInstances[0]
if ($sourceDb.DBInstanceArn -ne "arn:aws:rds:$region`:$account`:db:$databaseIdentifier" -or
    $sourceDb.DBInstanceStatus -ne 'available' -or $sourceDb.PubliclyAccessible -or -not $sourceDb.StorageEncrypted -or
    $sourceDb.Engine -ne 'postgres' -or $sourceDb.DBInstanceClass -ne 'db.t4g.micro') {
    throw 'The AWS-native staging database does not satisfy the restore-source boundary.'
}
$sourceTags = Invoke-AwsJson @('rds', 'list-tags-for-resource', '--resource-name', $sourceDb.DBInstanceArn)
$tagMap = @{}
foreach ($tag in @($sourceTags.TagList)) { $tagMap[$tag.Key] = $tag.Value }
if ($tagMap['Environment'] -ne 'staging' -or $tagMap['DataClassification'] -ne 'Synthetic-Non-PII' -or $tagMap['Backup'] -ne 'daily') {
    throw 'The restore source is not the tagged synthetic staging database.'
}

$existing = & aws.exe rds describe-db-instances --db-instance-identifier $TargetIdentifier --region $region --output json 2>&1
if ($LASTEXITCODE -eq 0) { throw 'The disposable restore target already exists.' }
if (($existing -join [Environment]::NewLine) -notmatch 'DBInstanceNotFound') { throw 'The disposable restore target absence could not be verified.' }

$plans = Invoke-AwsJson @('backup', 'list-backup-plans')
$plan = @($plans.BackupPlansList | Where-Object BackupPlanName -eq $backupPlanName)
if ($plan.Count -ne 1) { throw 'The exact staging backup plan was not found.' }
$selections = Invoke-AwsJson @('backup', 'list-backup-selections', '--backup-plan-id', $plan[0].BackupPlanId)
if (@($selections.BackupSelectionsList).Count -ne 1) { throw 'The staging backup plan must have exactly one selection.' }
$selection = Invoke-AwsJson @('backup', 'get-backup-selection', '--backup-plan-id', $plan[0].BackupPlanId, '--selection-id', $selections.BackupSelectionsList[0].SelectionId)
$roleArn = [string]$selection.BackupSelection.IamRoleArn
if ($roleArn -notmatch "^arn:aws:iam::$account`:role/.+") { throw 'The backup selection role is outside the staging account.' }
$roleName = ($roleArn -split '/')[-1]
$stackResources = Invoke-AwsJson @('cloudformation', 'list-stack-resources', '--stack-name', $backupStackName)
$roleResource = @($stackResources.StackResourceSummaries | Where-Object { $_.ResourceType -eq 'AWS::IAM::Role' -and $_.PhysicalResourceId -eq $roleName })
if ($roleResource.Count -ne 1) { throw 'The backup role is not owned by the bounded staging backup stack.' }

$planOnly = [ordered]@{
    format = 1
    execute = [bool]$Execute
    cleanup = [bool]$Cleanup
    account = $account
    region = $region
    sourceCommit = $SourceCommit
    sourceDatabaseArn = $sourceDb.DBInstanceArn
    backupVaultName = $vaultName
    backupPlanId = $plan[0].BackupPlanId
    backupSelectionId = $selections.BackupSelectionsList[0].SelectionId
    backupRoleArn = $roleArn
    targetIdentifier = $TargetIdentifier
    authorizationReference = $AuthorizationReference
    projectedMonthlyUsd = [math]::Round($projectedCents / 100, 2)
    valuesPrinted = $false
}
if (-not $Execute) {
    $planOnly | ConvertTo-Json -Depth 4
    return
}
if (-not $PSCmdlet.ShouldProcess($TargetIdentifier, 'Create a staging backup, restore it privately, verify its boundary, and optionally remove only the disposable restore')) { return }

$backupToken = "tracepoint-$($SourceCommit.Substring(0,12))-backup"
$backupStartedAt = [DateTime]::UtcNow
$backup = Invoke-AwsJson @(
    'backup', 'start-backup-job', '--backup-vault-name', $vaultName,
    '--resource-arn', $sourceDb.DBInstanceArn, '--iam-role-arn', $roleArn,
    '--idempotency-token', $backupToken, '--start-window-minutes', '60',
    '--complete-window-minutes', '240', '--lifecycle', 'DeleteAfterDays=7',
    '--recovery-point-tags', "Purpose=full-aws-staging-restore-proof,SourceCommit=$SourceCommit,DataClassification=Synthetic-Non-PII"
)
$backupResult = Wait-BackupJob -JobId $backup.BackupJobId -Deadline $backupStartedAt.AddMinutes($BackupTimeoutMinutes)
$backupCompletedAt = [DateTime]::UtcNow
$recoveryPointArn = [string]$backupResult.RecoveryPointArn
if ($backupResult.ResourceArn -ne $sourceDb.DBInstanceArn -or
    $recoveryPointArn -notmatch "^arn:aws:rds:$region`:$account`:snapshot:awsbackup:job-[0-9a-f-]{36}$") {
    throw 'The completed backup job did not produce the expected bounded recovery point.'
}

$metadataResponse = Invoke-AwsJson @('backup', 'get-recovery-point-restore-metadata', '--backup-vault-name', $vaultName, '--recovery-point-arn', $recoveryPointArn)
$restoreMetadata = @{}
$metadataResponse.RestoreMetadata.PSObject.Properties | ForEach-Object { $restoreMetadata[$_.Name] = [string]$_.Value }
$restoreMetadata.Remove('DBSnapshotIdentifier')
$restoreMetadata['DBInstanceIdentifier'] = $TargetIdentifier
$restoreMetadata['DBInstanceClass'] = 'db.t4g.micro'
$restoreMetadata['DBSubnetGroupName'] = [string]$sourceDb.DBSubnetGroup.DBSubnetGroupName
$restoreMetadata['VpcSecurityGroupIds'] = (@($sourceDb.VpcSecurityGroups.VpcSecurityGroupId) | ConvertTo-Json -Compress)
$restoreMetadata['PubliclyAccessible'] = 'false'
$restoreMetadata['MultiAZ'] = 'false'
$restoreMetadata['DeletionProtection'] = 'false'
$restoreMetadata['CopyTagsToSnapshot'] = 'false'
$restoreJson = $restoreMetadata | ConvertTo-Json -Compress
$restoreStartedAt = [DateTime]::UtcNow
$restore = Invoke-AwsJson @(
    'backup', 'start-restore-job', '--recovery-point-arn', $recoveryPointArn,
    '--metadata', $restoreJson, '--iam-role-arn', $roleArn,
    '--resource-type', 'RDS', '--no-copy-source-tags-to-restored-resource',
    '--idempotency-token', "restore-$TargetIdentifier"
)
$restoreResult = Wait-RestoreJob -JobId $restore.RestoreJobId -Deadline $restoreStartedAt.AddMinutes($RestoreTimeoutMinutes)
$restored = Invoke-AwsJson @('rds', 'describe-db-instances', '--db-instance-identifier', $TargetIdentifier)
if (@($restored.DBInstances).Count -ne 1) { throw 'The completed restore did not produce one disposable database.' }
$restoredDb = $restored.DBInstances[0]
$sourceSecurityGroups = @($sourceDb.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
$restoredSecurityGroups = @($restoredDb.VpcSecurityGroups.VpcSecurityGroupId | Sort-Object)
if ($restoredDb.DBInstanceStatus -ne 'available' -or $restoredDb.PubliclyAccessible -or -not $restoredDb.StorageEncrypted -or
    $restoredDb.Engine -ne 'postgres' -or $restoredDb.DBInstanceClass -ne 'db.t4g.micro' -or $restoredDb.MultiAZ -or
    $restoredDb.DBSubnetGroup.VpcId -ne $sourceDb.DBSubnetGroup.VpcId -or
    ($sourceSecurityGroups -join ',') -ne ($restoredSecurityGroups -join ',') -or
    $restoredDb.KmsKeyId -ne $sourceDb.KmsKeyId) {
    throw 'The restored database does not match the private encrypted staging recovery boundary.'
}

$restoreTags = @(
    'rds', 'add-tags-to-resource', '--resource-name', $restoredDb.DBInstanceArn, '--tags',
    'Key=Purpose,Value=full-aws-staging-restore-proof',
    'Key=DataClassification,Value=Synthetic-Non-PII',
    "Key=SourceCommit,Value=$SourceCommit",
    "Key=AuthorizationReference,Value=$AuthorizationReference",
    'Key=Disposable,Value=true', '--region', $region
)
& aws.exe @restoreTags | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Disposable restore tagging failed.' }

$evidence = [ordered]@{}
foreach ($property in $planOnly.PSObject.Properties) { $evidence[$property.Name] = $property.Value }
$evidence['backupJobId'] = $backup.BackupJobId
$evidence['backupStatus'] = $backupResult.State
$evidence['backupDurationSeconds'] = [math]::Round(($backupCompletedAt - $backupStartedAt).TotalSeconds)
$evidence['recoveryPointArn'] = $recoveryPointArn
$evidence['restoreJobId'] = $restore.RestoreJobId
$evidence['restoreStatus'] = $restoreResult.Status
$evidence['restoreDurationSeconds'] = [math]::Round(([DateTime]::UtcNow - $restoreStartedAt).TotalSeconds)
$evidence['restoredDatabaseArn'] = $restoredDb.DBInstanceArn
$evidence['restoredPrivate'] = -not [bool]$restoredDb.PubliclyAccessible
$evidence['restoredEncrypted'] = [bool]$restoredDb.StorageEncrypted
$evidence['restoredVpcMatched'] = $true
$evidence['restoredSecurityGroupsMatched'] = $true
$evidence['cleanupCompleted'] = $false

if ($Cleanup) {
    $cleanupApproval = $env:TRACEPOINT_STAGING_RESTORE_CLEANUP_AUTHORIZATION
    if ($cleanupApproval -cne $AuthorizationReference) { throw 'Run-bound authorization is required to remove the disposable restore.' }
    $verifiedTags = Invoke-AwsJson @('rds', 'list-tags-for-resource', '--resource-name', $restoredDb.DBInstanceArn)
    $verifiedTagMap = @{}
    foreach ($tag in @($verifiedTags.TagList)) { $verifiedTagMap[$tag.Key] = $tag.Value }
    if ($restoredDb.DBInstanceIdentifier -ne $TargetIdentifier -or $verifiedTagMap['Disposable'] -ne 'true' -or
        $verifiedTagMap['Purpose'] -ne 'full-aws-staging-restore-proof' -or $verifiedTagMap['SourceCommit'] -ne $SourceCommit -or
        $verifiedTagMap['DataClassification'] -ne 'Synthetic-Non-PII' -or $verifiedTagMap['AuthorizationReference'] -ne $AuthorizationReference) {
        throw 'Disposable cleanup boundary could not be re-established.'
    }
    & aws.exe rds delete-db-instance --db-instance-identifier $TargetIdentifier --skip-final-snapshot --delete-automated-backups --region $region | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Disposable restore deletion did not start.' }
    Wait-DatabaseDeleted -Identifier $TargetIdentifier -Deadline ([DateTime]::UtcNow.AddMinutes(60))
    $evidence['cleanupCompleted'] = $true
}

[IO.File]::WriteAllText(
    (Join-Path (Resolve-Path -LiteralPath $parent).Path (Split-Path -Leaf $EvidenceOutputPath)),
    ($evidence | ConvertTo-Json -Depth 5) + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)
Write-Host "AWS Backup restore proof passed for immutable source $SourceCommit; no credential or database values were printed."
