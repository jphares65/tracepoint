Set-StrictMode -Version Latest

$script:ExpectedAccount = '559054714699'
$script:DeniedAccount = '265544358665'
$script:ExpectedRegion = 'us-east-1'
$script:DefaultProfile = 'tracepoint-member-staging'

function Assert-TracePointStagingIdentity {
    param([string]$Profile = $script:DefaultProfile)

    if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) {
        throw 'aws.exe is required. No installation was attempted.'
    }
    $env:AWS_REGION = $script:ExpectedRegion
    $env:AWS_DEFAULT_REGION = $script:ExpectedRegion
    $identity = & aws.exe sts get-caller-identity --profile $Profile --region $script:ExpectedRegion --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'AWS STS identity verification failed.' }
    $identity = ($identity -join [Environment]::NewLine) | ConvertFrom-Json
    if ($identity.Account -eq $script:DeniedAccount) { throw "Refusing management account $script:DeniedAccount." }
    if ($identity.Account -ne $script:ExpectedAccount) { throw "Refusing account '$($identity.Account)'." }
    if ($identity.Arn -notlike '*TracePointMigrationStaging*') { throw 'TracePointMigrationStaging role is required.' }
    if ($env:AWS_REGION -ne $script:ExpectedRegion -or $env:AWS_DEFAULT_REGION -ne $script:ExpectedRegion) {
        throw "Refusing region outside $script:ExpectedRegion."
    }
    return $identity
}

function Assert-TracePointStagingHostname {
    param([Parameter(Mandatory)][string]$Hostname)
    if ($Hostname -ne 'staging.tracepointhq.com') {
        throw "Refusing hostname '$Hostname'; expected staging.tracepointhq.com."
    }
}

function ConvertFrom-TracePointSecureString {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Export-ModuleMember -Function Assert-TracePointStagingIdentity, Assert-TracePointStagingHostname, ConvertFrom-TracePointSecureString
