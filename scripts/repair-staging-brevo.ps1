[CmdletBinding()]
param([Security.SecureString]$BrevoApiKey)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
if ($null -eq $BrevoApiKey) { $BrevoApiKey = Read-Host -AsSecureString 'Paste the authorized staging Brevo API key using the terminal paste command' }
$raw = $null
$secret = $null
try {
    $raw = & aws.exe secretsmanager get-secret-value --secret-id tracepoint/staging/application --query SecretString --output text --region us-east-1 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Cannot retrieve current staging secret.' }
    try { $secret = ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
    catch { throw 'Current staging secret is not valid JSON; no change was made.' }
    $secret.BREVO_API_KEY = ConvertFrom-TracePointSecureString $BrevoApiKey
    $secret | ConvertTo-Json -Compress | & node (Join-Path $PSScriptRoot 'replace-staging-secret.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Staging Brevo repair failed validation or readback.' }
    Write-Host 'Brevo key replaced and verified; the other seven fields are preserved. No email was sent and ECS was not restarted.'
} finally { $raw = $null; $secret = $null; $BrevoApiKey = $null }
