[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Security.SecureString]$SupabaseSecretKey,
    [Security.SecureString]$BrevoApiKey,
    [Security.SecureString]$NotificationDispatchSecret,
    [Security.SecureString]$NextServerActionsEncryptionKey,
    [Security.SecureString]$NextPublicSupabaseUrl,
    [Security.SecureString]$NextPublicSupabasePublishableKey,
    [Security.SecureString]$NextPublicSiteUrl,
    [Security.SecureString]$ConfigurationEnvironment
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null

$parameters = @(
    'SupabaseSecretKey',
    'BrevoApiKey',
    'NotificationDispatchSecret',
    'NextServerActionsEncryptionKey',
    'NextPublicSupabaseUrl',
    'NextPublicSupabasePublishableKey',
    'NextPublicSiteUrl',
    'ConfigurationEnvironment'
)
foreach ($name in $parameters) {
    if ($null -eq (Get-Variable -Name $name -ValueOnly)) {
        Set-Variable -Name $name -Value (Read-Host -AsSecureString "Enter $name for staging")
    }
}

$plain = @{}
try {
    foreach ($name in $parameters) {
        $plain[$name] = ConvertFrom-TracePointSecureString (Get-Variable -Name $name -ValueOnly)
        if ([string]::IsNullOrWhiteSpace($plain[$name])) { throw "$name cannot be empty." }
        if ($plain[$name] -match '(?i)\b(prod|production)\b') { throw "$name looks production-scoped; refusing." }
    }
    $keyBytes = [Convert]::FromBase64String($plain.NextServerActionsEncryptionKey)
    if ($keyBytes.Length -notin @(16, 24, 32)) { throw 'NextServerActionsEncryptionKey must encode a 16, 24, or 32 byte AES key.' }
    $supabaseUri = [uri]$plain.NextPublicSupabaseUrl
    if ($supabaseUri.Scheme -ne 'https' -or $supabaseUri.DnsSafeHost -notlike '*.supabase.co') {
        throw 'NextPublicSupabaseUrl must be an HTTPS Supabase project URL.'
    }
    if ($plain.NextPublicSiteUrl -ne 'https://staging.tracepointhq.com') {
        throw 'NextPublicSiteUrl must exactly equal the approved staging hostname.'
    }
    if ($plain.ConfigurationEnvironment -cne 'staging') {
        throw 'ConfigurationEnvironment must exactly equal staging.'
    }

    $payload = [ordered]@{
        SUPABASE_SECRET_KEY = $plain.SupabaseSecretKey
        BREVO_API_KEY = $plain.BrevoApiKey
        NOTIFICATION_DISPATCH_SECRET = $plain.NotificationDispatchSecret
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = $plain.NextServerActionsEncryptionKey
        NEXT_PUBLIC_SUPABASE_URL = $plain.NextPublicSupabaseUrl
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $plain.NextPublicSupabasePublishableKey
        NEXT_PUBLIC_SITE_URL = $plain.NextPublicSiteUrl
        CONFIGURATION_ENVIRONMENT = $plain.ConfigurationEnvironment
    } | ConvertTo-Json -Compress

    $payload | & node (Join-Path $PSScriptRoot 'validate-staging-provider-config.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Staging provider credentials failed; retained secret was not changed.' }

    if (-not $PSCmdlet.ShouldProcess('tracepoint/staging/application in account 559054714699', 'Replace the complete staging secret value')) { return }
    $payload | & node (Join-Path $PSScriptRoot 'replace-staging-secret.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Secret replacement failed.' }
    Write-Host 'The staging application secret was replaced atomically; no value was printed or written to local storage.'
}
finally {
    $payload = $null
    foreach ($name in @($plain.Keys)) { $plain[$name] = $null }
}
