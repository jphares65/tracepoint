[CmdletBinding()]
param(
    [Parameter(Mandatory)][uri]$BaseUri,
    [string]$Profile = 'tracepoint-member-staging',
    [string]$SessionCookie = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingHostname -Hostname $BaseUri.DnsSafeHost
Assert-TracePointStagingIdentity -Profile $Profile | Out-Null

$headers = @{}
if ($SessionCookie) { $headers.Cookie = $SessionCookie }
$checks = @(
    @{ Name = 'health'; Path = '/api/health'; Anonymous = $true },
    @{ Name = 'session'; Path = '/api/access' },
    @{ Name = 'current rules'; Path = '/api/settings/current-rules' },
    @{ Name = 'qualifications'; Path = '/api/qualifications' },
    @{ Name = 'certification types'; Path = '/api/training/certification-types' },
    @{ Name = 'course catalog'; Path = '/api/agency-training/courses' },
    @{ Name = 'equipment assets'; Path = '/api/equipment/assets' },
    @{ Name = 'equipment requirements'; Path = '/api/equipment/requirements' },
    @{ Name = 'equipment types'; Path = '/api/equipment/types' }
)
foreach ($check in $checks) {
    $isAnonymous = $check.ContainsKey('Anonymous') -and $check.Anonymous
    $requestHeaders = if ($isAnonymous) { @{} } else { $headers }
    try {
        $response = Invoke-WebRequest -Uri ([uri]::new($BaseUri, $check.Path)) -Headers $requestHeaders -MaximumRedirection 0 -SkipHttpErrorCheck
        $acceptable = if ($isAnonymous) { $response.StatusCode -eq 200 } elseif ($SessionCookie) { $response.StatusCode -eq 200 } else { $response.StatusCode -in @(401, 403) }
        if (-not $acceptable) { throw "unexpected HTTP $($response.StatusCode)" }
        Write-Host "$($check.Name): HTTP $($response.StatusCode)"
    }
    catch { throw "Smoke check '$($check.Name)' failed: $($_.Exception.Message)" }
}
