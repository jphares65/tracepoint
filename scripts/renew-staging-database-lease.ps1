[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ExpiresAfterUtc,
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 .@_-]{2,79}$')][string]$LeaseOwner,
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$')][string]$LeaseReference,
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$account = '559054714699'
$region = 'us-east-1'
$parameter = '/tracepoint/staging/database-release-lease'
Assert-TracePointStagingIdentity | Out-Null

$normalizedExpiry = & node (Join-Path $PSScriptRoot 'validate-database-lease-input.mjs') $ExpiresAfterUtc $LeaseOwner $LeaseReference
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$normalizedExpiry)) { throw 'Lease input validation failed.' }
$lease = [ordered]@{ expiresAfterUtc = [string]$normalizedExpiry; leaseOwner = $LeaseOwner; leaseReference = $LeaseReference }
$leaseJson = $lease | ConvertTo-Json -Compress

if (-not $Execute) {
  Write-Output ([ordered]@{ account = $account; parameter = $parameter; value = $lease; approved = $true; execute = $false } | ConvertTo-Json -Compress)
  return
}

& aws.exe ssm put-parameter --name $parameter --type String --value $leaseJson --overwrite --region $region | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Staging release lease write failed.' }
$stored = & aws.exe ssm get-parameter --name $parameter --region $region --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Staging release lease readback failed.' }
$storedJson = (($stored -join [Environment]::NewLine) | ConvertFrom-Json).Parameter.Value
$validated = $storedJson | & node (Join-Path $PSScriptRoot 'validate-staging-database-release-lease.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Staging release lease readback is invalid.' }
$storedLease = ($validated -join [Environment]::NewLine) | ConvertFrom-Json
if ($storedLease.expiresAfterUtc -ne $lease.expiresAfterUtc -or $storedLease.leaseOwner -ne $lease.leaseOwner -or $storedLease.leaseReference -ne $lease.leaseReference) { throw 'Staging release lease readback does not match the requested value.' }
Write-Output ([ordered]@{ account = $account; parameter = $parameter; value = $storedLease; approved = $true; execute = $true } | ConvertTo-Json -Compress)
