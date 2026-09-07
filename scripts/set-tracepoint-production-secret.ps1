param(
    [Parameter(Mandatory = $false)] [Security.SecureString] $BrevoApiKey,
    [Parameter(Mandatory = $false)] [string] $Config = 'infra/.temp/production-target.json'
)
$ErrorActionPreference = 'Stop'
if ($null -eq $BrevoApiKey) { $BrevoApiKey = Read-Host -AsSecureString 'Paste the authorized production Brevo API key' }
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($BrevoApiKey)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $plain | node --experimental-strip-types --env-file=.env.local scripts/finalize-production-secret.mts --config $Config
    if ($LASTEXITCODE -ne 0) { throw 'Production secret finalization failed validation or readback.' }
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plain = $null
    $BrevoApiKey = $null
}
