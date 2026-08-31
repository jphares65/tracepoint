[CmdletBinding()]
param(
    [switch]$SkipAws,
    [string]$Profile = ''
)

$ErrorActionPreference = 'Stop'
$expectedAccount = '559054714699'
$deniedAccount = '265544358665'
$expectedRegion = 'us-east-1'
$expectedEnvironment = 'tracepoint-staging'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not available. No installation was attempted."
    }
}

foreach ($command in @('git', 'node', 'npm', 'npx')) {
    Require-Command $command
}

$resolvedRoot = (Resolve-Path -LiteralPath $repositoryRoot).Path
$gitRoot = (& git -C $resolvedRoot rev-parse --show-toplevel).Trim()
if ((Resolve-Path -LiteralPath $gitRoot).Path -ne $resolvedRoot) {
    throw "Preflight must run from the TracePoint repository root."
}

$protectedPath = 'src/app/integration-demo/page.tsx'
$protectedStatus = & git -C $resolvedRoot status --short --untracked-files=all -- $protectedPath
if ($protectedStatus -ne "?? $protectedPath") {
    throw "$protectedPath must remain present, untracked, and unmodified by migration work."
}

$unexpectedChanges = @(& git -C $resolvedRoot status --short --untracked-files=all | Where-Object {
    $_ -notmatch '^\?\? src/app/integration-demo/page\.tsx$'
})
if ($unexpectedChanges.Count -gt 0) {
    Write-Warning "Repository contains reviewable changes in addition to the protected untracked file."
    $unexpectedChanges | ForEach-Object { Write-Host "  $_" }
}

if (-not (Test-Path -LiteralPath (Join-Path $resolvedRoot 'infra/node_modules/aws-cdk-lib'))) {
    throw 'CDK dependencies are not present under infra/node_modules. No installation was attempted.'
}

if (-not $SkipAws) {
    if (-not (Get-Command 'aws' -ErrorAction SilentlyContinue)) {
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    Require-Command 'aws'

    $profileArguments = @()
    if ($Profile) {
        $knownProfiles = @(& aws configure list-profiles)
        if ($Profile -notin $knownProfiles) {
            throw "AWS CLI profile '$Profile' was not found. No fallback profile was used."
        }
        $profileArguments = @('--profile', $Profile)
    }

    $identity = & aws sts get-caller-identity --region $expectedRegion @profileArguments --output json |
        ConvertFrom-Json
    if ($identity.Account -eq $deniedAccount) {
        throw "Refusing management account $deniedAccount."
    }
    if ($identity.Account -ne $expectedAccount) {
        throw "Expected staging account $expectedAccount; observed '$($identity.Account)'."
    }

    Write-Host "AWS identity verified: account $($identity.Account), ARN $($identity.Arn)"
}

Write-Host "Preflight passed for environment $expectedEnvironment, account $expectedAccount, region $expectedRegion."
Write-Host 'This script performs checks only and does not bootstrap, synthesize, deploy, or mutate AWS resources.'
