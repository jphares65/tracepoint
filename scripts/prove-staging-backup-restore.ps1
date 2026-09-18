[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][string]$RecoveryPointArn,
    [Parameter(Mandatory = $true)][ValidatePattern('^tracepoint-staging-restore-[a-z0-9-]{1,40}$')][string]$TargetIdentifier,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._:/-]{3,160}$')][string]$AuthorizationReference,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$account = '559054714699'
$identity = aws sts get-caller-identity --region $region --output json | ConvertFrom-Json
if ($identity.Account -ne $account -or $identity.Arn -notmatch ':assumed-role/TracePointMigrationStaging(?:_|/)') { throw 'Staging identity mismatch.' }
if ($RecoveryPointArn -notlike "arn:aws:backup:$region`:$account`:recovery-point:*") { throw 'Recovery point is outside the bounded staging account and region.' }
$metadata = aws backup get-recovery-point-restore-metadata --backup-vault-name tracepoint-staging --recovery-point-arn $RecoveryPointArn --region $region --output json | ConvertFrom-Json
$restoreMetadata = @{}
$metadata.RestoreMetadata.psobject.Properties | ForEach-Object { $restoreMetadata[$_.Name] = $_.Value }
$restoreMetadata['DBInstanceIdentifier'] = $TargetIdentifier
$restoreMetadata['PubliclyAccessible'] = 'false'
$restoreMetadata['MultiAZ'] = 'false'
$plan = [ordered]@{ dryRun = -not $Execute; account = $account; region = $region; vault = 'tracepoint-staging'; recoveryPointArn = $RecoveryPointArn; targetIdentifier = $TargetIdentifier; authorizationReference = $AuthorizationReference }
if (-not $Execute) { $plan | ConvertTo-Json -Compress; return }
if (-not $PSCmdlet.ShouldProcess($TargetIdentifier, 'Start isolated AWS Backup restore proof')) { return }
$started = Get-Date
$restoreJson = $restoreMetadata | ConvertTo-Json -Compress
$job = aws backup start-restore-job --recovery-point-arn $RecoveryPointArn --metadata $restoreJson --iam-role-arn "arn:aws:iam::$account`:role/service-role/AWSBackupDefaultServiceRole" --idempotency-token ([guid]::NewGuid().ToString()) --region $region --output json | ConvertFrom-Json
do {
    Start-Sleep -Seconds 20
    $status = aws backup describe-restore-job --restore-job-id $job.RestoreJobId --region $region --output json | ConvertFrom-Json
} while ($status.Status -in @('PENDING', 'RUNNING'))
if ($status.Status -ne 'COMPLETED') { throw "Restore proof failed with status $($status.Status)." }
$restored = aws rds describe-db-instances --db-instance-identifier $TargetIdentifier --region $region --output json | ConvertFrom-Json
if ($restored.DBInstances.Count -ne 1 -or $restored.DBInstances[0].PubliclyAccessible) { throw 'Restored database boundary validation failed.' }
[ordered]@{ restoreJobId = $job.RestoreJobId; targetIdentifier = $TargetIdentifier; status = $status.Status; durationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds); publiclyAccessible = $false; authorizationReference = $AuthorizationReference } | ConvertTo-Json -Compress
