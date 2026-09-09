[CmdletBinding()]
param([Parameter(Mandatory)][uri]$BaseUri,[string]$SessionCookie = '')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($BaseUri.AbsoluteUri.TrimEnd('/') -ne 'https://staging.tracepointhq.com'){throw 'Only the exact staging HTTPS origin is allowed.'}
$savedCookie=[Environment]::GetEnvironmentVariable('TRACEPOINT_STAGING_SESSION_COOKIE')
try {
    $env:TRACEPOINT_STAGING_SESSION_COOKIE=$SessionCookie
    & node (Join-Path $PSScriptRoot 'test-staging-http.mjs')
    if($LASTEXITCODE -ne 0){throw 'Staging HTTP smoke failed.'}
} finally {$env:TRACEPOINT_STAGING_SESSION_COOKIE=$savedCookie}
