[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ExpiresAfterUtc,
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 .@_-]{2,79}$')][string]$LeaseOwner,
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$')][string]$LeaseReference,
  [switch]$Execute
)
Set-StrictMode -Version Latest; $ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
$stack='tracepoint-staging-database'; $account='559054714699'; $region='us-east-1'
Assert-TracePointStagingIdentity | Out-Null
node (Join-Path $PSScriptRoot 'validate-database-lease-input.mjs') $ExpiresAfterUtc $LeaseOwner $LeaseReference
if($LASTEXITCODE -ne 0){throw 'Lease input validation failed.'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path;$infra=Join-Path $root 'infra';$assembly=Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-lease-synth-'+[guid]::NewGuid().ToString('N'))
$contexts=@('-c',"account=$account",'-c',"region=$region",'-c','environment=tracepoint-staging','-c','providerMode=aws-native','-c','databaseEnabled=true','-c',"databaseExpiresAfterUtc=$ExpiresAfterUtc",'-c',"databaseLeaseOwner=$LeaseOwner",'-c',"databaseLeaseReference=$LeaseReference",'-c','privateStorageEnabled=true','-c','storageProvider=s3','--lookups=false')
Push-Location $infra;try{& npx.cmd cdk synth $stack @contexts --strict --quiet --output $assembly;if($LASTEXITCODE -ne 0){throw 'Lease-only database synthesis failed.'};$cdkDiff=& npx.cmd cdk diff $stack @contexts --exclusively --no-change-set --fail=false 2>&1;if($LASTEXITCODE -ne 0){throw 'Lease-only database CDK diff failed.'}}finally{Pop-Location}
$existing=aws.exe cloudformation describe-stacks --stack-name $stack --region $region --output json | ConvertFrom-Json
if($existing.Stacks[0].StackStatus -notin @('CREATE_COMPLETE','UPDATE_COMPLETE')){throw 'Database stack is not stable.'}
$tags=@($existing.Stacks[0].Tags | Where-Object {$_.Key -notin @('ExpiresAfterUTC','LeaseOwner','LeaseReference')})
$tags += @(@{Key='ExpiresAfterUTC';Value=$ExpiresAfterUtc},@{Key='LeaseOwner';Value=$LeaseOwner},@{Key='LeaseReference';Value=$LeaseReference})
$name=('lease-'+[guid]::NewGuid().ToString('N'))
$args=@('cloudformation','create-change-set','--stack-name',$stack,'--change-set-name',$name,'--change-set-type','UPDATE','--use-previous-template','--tags') + ($tags | ForEach-Object {"Key=$($_.Key),Value=$($_.Value)"}) + @('--region',$region)
aws.exe @args | Out-Null; if($LASTEXITCODE -ne 0){throw 'Lease change-set creation failed.'}
try { aws.exe cloudformation wait change-set-create-complete --stack-name $stack --change-set-name $name --region $region; $changes=(aws.exe cloudformation describe-change-set --stack-name $stack --change-set-name $name --region $region --output json | ConvertFrom-Json).Changes; $changes | ConvertTo-Json -Depth 20 | node (Join-Path $PSScriptRoot 'validate-database-lease-changeset.mjs'); if($LASTEXITCODE -ne 0){throw 'Lease change-set exceeded approved tag scope.'}; Write-Output ([ordered]@{account=$account;stack=$stack;oldExpiry=($existing.Stacks[0].Tags|Where-Object Key -eq 'ExpiresAfterUTC').Value;newExpiry=$ExpiresAfterUtc;leaseOwner=$LeaseOwner;leaseReference=$LeaseReference;changeSet=$name;cdkDiff=$cdkDiff -join [Environment]::NewLine;approved=$true}|ConvertTo-Json -Compress); if($Execute){aws.exe cloudformation execute-change-set --stack-name $stack --change-set-name $name --region $region; aws.exe cloudformation wait stack-update-complete --stack-name $stack --region $region}else{Write-Output 'Dry run only; change set will be deleted.'} } finally { if(-not $Execute){aws.exe cloudformation delete-change-set --stack-name $stack --change-set-name $name --region $region 2>$null} }
