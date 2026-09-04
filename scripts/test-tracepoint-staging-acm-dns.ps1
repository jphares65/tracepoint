[CmdletBinding()]
param([Parameter(Mandatory)][string]$Hostname)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingHostname -Hostname $Hostname
Assert-TracePointStagingIdentity | Out-Null

$certificates = & aws.exe acm list-certificates --certificate-statuses ISSUED --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Unable to list issued staging certificates.' }
$match = (($certificates -join [Environment]::NewLine) | ConvertFrom-Json).CertificateSummaryList |
    Where-Object DomainName -eq $Hostname | Select-Object -First 1
$addresses = @(Resolve-DnsName -Name $Hostname -ErrorAction SilentlyContinue | Where-Object Type -in @('A', 'AAAA', 'CNAME'))
if ($match) { Write-Host 'Issued certificate: ready' }
else { Write-Host 'Issued certificate: missing' }
if ($addresses.Count) { Write-Host 'Public DNS record: present' }
else { Write-Host 'Public DNS record: missing' }
Write-Host 'Readiness check made no certificate or DNS change.'
if (-not $match -or -not $addresses.Count) { exit 2 }
