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
$existing=aws.exe cloudformation describe-stacks --stack-name $stack --region $region --output json | ConvertFrom-Json
if($existing.Stacks[0].StackStatus -notin @('CREATE_COMPLETE','UPDATE_COMPLETE')){throw 'Database stack is not stable.'}
$deployedTemplate=aws.exe cloudformation get-template --stack-name $stack --template-stage Original --region $region --output json | ConvertFrom-Json
if([string]::IsNullOrWhiteSpace([string]$deployedTemplate.TemplateBody)){throw 'Deployed database template is unavailable.'}
$templateText=if($deployedTemplate.TemplateBody -is [string]){$deployedTemplate.TemplateBody}else{$deployedTemplate.TemplateBody | ConvertTo-Json -Depth 100 -Compress}
$templateHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($templateText))).ToLowerInvariant()
$tags=@($existing.Stacks[0].Tags | Where-Object {$_.Key -notin @('ExpiresAfterUTC','LeaseOwner','LeaseReference')})
$tags += @(@{Key='ExpiresAfterUTC';Value=$ExpiresAfterUtc},@{Key='LeaseOwner';Value=$LeaseOwner},@{Key='LeaseReference';Value=$LeaseReference})
$parameters=@($existing.Stacks[0].Parameters | ForEach-Object {"ParameterKey=$($_.ParameterKey),UsePreviousValue=true"})
$capabilities=@()
if($templateText -match 'AWS::IAM::'){$capabilities += 'CAPABILITY_NAMED_IAM'}
if($templateText -match '(?m)^\s*Transform\s*:|"Transform"\s*:'){$capabilities += 'CAPABILITY_AUTO_EXPAND'}
$name=('tracepoint-staging-database-lease-'+[guid]::NewGuid().ToString('N'))
$args=@('cloudformation','create-change-set','--stack-name',$stack,'--change-set-name',$name,'--change-set-type','UPDATE','--use-previous-template','--tags') + ($tags | ForEach-Object {"Key=$($_.Key),Value=$($_.Value)"})
if($parameters.Count -gt 0){$args += @('--parameters') + $parameters}
if($capabilities.Count -gt 0){$args += @('--capabilities') + $capabilities}
$args += @('--region',$region)
aws.exe @args | Out-Null; if($LASTEXITCODE -ne 0){throw 'Lease change-set creation failed.'}
try { aws.exe cloudformation wait change-set-create-complete --stack-name $stack --change-set-name $name --region $region; $changes=(aws.exe cloudformation describe-change-set --stack-name $stack --change-set-name $name --region $region --output json | ConvertFrom-Json).Changes; $changes | ConvertTo-Json -Depth 20 | node (Join-Path $PSScriptRoot 'validate-database-lease-changeset.mjs'); if($LASTEXITCODE -ne 0){throw 'Lease change-set exceeded approved tag scope.'}; Write-Output ([ordered]@{account=$account;stack=$stack;templateSha256=$templateHash;oldExpiry=($existing.Stacks[0].Tags|Where-Object Key -eq 'ExpiresAfterUTC').Value;newExpiry=$ExpiresAfterUtc;leaseOwner=$LeaseOwner;leaseReference=$LeaseReference;changeSet=$name;approved=$true}|ConvertTo-Json -Compress); if($Execute){aws.exe cloudformation execute-change-set --stack-name $stack --change-set-name $name --region $region; aws.exe cloudformation wait stack-update-complete --stack-name $stack --region $region}else{Write-Output 'Dry run only; change set will be deleted.'} } finally { if(-not $Execute){aws.exe cloudformation delete-change-set --stack-name $stack --change-set-name $name --region $region 2>$null} }
