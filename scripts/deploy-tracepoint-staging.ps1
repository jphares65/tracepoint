[CmdletBinding()]
param(
    [ValidateSet('Verify', 'DeployRuntime')][string]$Action = 'Verify',
    [string]$ImageTag,
    [string]$CertificateArn,
    [string]$Profile = 'tracepoint-member-staging'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$account = '559054714699'
$region = 'us-east-1'
$environment = 'tracepoint-staging'
$repository = 'tracepoint-staging'
$runtimeStack = 'tracepoint-staging-runtime'
$budgetName = 'tracepoint-staging-monthly-75'
$budgetLimit = 75
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$infraRoot = Join-Path $repositoryRoot 'infra'
$protectedPaths = @('scripts/seed-demo-fleet-equipment.mjs', 'src/app/integration-demo')

function Invoke-AwsJson {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & aws.exe @Arguments --profile $Profile --region $region --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "AWS command failed: aws $($Arguments -join ' ')" }
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Assert-NoProtectedChanges {
    foreach ($path in $protectedPaths) {
        $status = @(& git.exe -C $repositoryRoot status --short --untracked-files=all -- $path)
        if ($status.Count -eq 0 -or @($status | Where-Object { $_ -notlike '?? *' }).Count -ne 0) {
            throw "Protected path '$path' must remain present, untracked, and unmodified."
        }
    }
}

function Assert-CostGate {
    $monthlyCents = 2431 + 1266 + 150 + 70 + 290
    if ($monthlyCents -gt ($budgetLimit * 100)) { throw 'Projected staging cost exceeds the approved ceiling.' }
    $budgets = Invoke-AwsJson @('budgets', 'describe-budgets', '--account-id', $account)
    $budget = @($budgets.Budgets | Where-Object BudgetName -eq $budgetName)
    if ($budget.Count -ne 1 -or [decimal]$budget[0].BudgetLimit.Amount -ne $budgetLimit -or $budget[0].BudgetLimit.Unit -ne 'USD') {
        throw "The existing $budgetLimit USD staging budget gate is not satisfied."
    }
}

function Get-ImmutableImage {
    if ([string]::IsNullOrWhiteSpace($ImageTag) -or $ImageTag -eq 'latest' -or $ImageTag -notmatch '^[0-9a-f]{40}$') {
        throw 'ImageTag must be the full lowercase commit SHA produced by the separate publishing workflow.'
    }
    $repositoryState = Invoke-AwsJson @('ecr', 'describe-repositories', '--repository-names', $repository)
    if ($repositoryState.repositories[0].imageTagMutability -ne 'IMMUTABLE') { throw 'The staging ECR repository is not immutable.' }
    $image = Invoke-AwsJson @('ecr', 'describe-images', '--repository-name', $repository, '--image-ids', "imageTag=$ImageTag")
    if (@($image.imageDetails).Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$image.imageDetails[0].imageDigest)) {
        throw "Immutable image '$ImageTag' is not available from the publishing workflow."
    }
    return [string]$image.imageDetails[0].imageDigest
}

function Assert-RuntimeSecretConfiguration {
    # Capture and inspect only required names; never emit the secret value.
    $secretText = & aws.exe secretsmanager get-secret-value --secret-id tracepoint/staging/application --query SecretString --output text --profile $Profile --region $region 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'The retained staging application secret cannot be retrieved and decrypted.' }
    try {
        $secret = ($secretText -join [Environment]::NewLine) | ConvertFrom-Json
        $required = @('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SITE_URL', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', 'SUPABASE_SECRET_KEY', 'BREVO_API_KEY', 'NOTIFICATION_DISPATCH_SECRET', 'CONFIGURATION_ENVIRONMENT')
        $missing = @($required | Where-Object { $null -eq $secret.PSObject.Properties[$_] -or [string]::IsNullOrWhiteSpace([string]$secret.PSObject.Properties[$_].Value) })
        if ($missing.Count) { throw "The retained staging secret is missing required names: $($missing -join ', ')." }
        if ($secret.CONFIGURATION_ENVIRONMENT -ne 'staging' -or $secret.NEXT_PUBLIC_SITE_URL -ne 'https://staging.tracepointhq.com') {
            throw 'The retained secret fails the staging/production-safety gate.'
        }
    }
    finally { $secretText = $null; $secret = $null }
}

Assert-TracePointStagingIdentity -Profile $Profile | Out-Null
Assert-NoProtectedChanges
Assert-CostGate

if ($Action -eq 'Verify') {
    Write-Host 'Staging runtime gates verified. Image publication remains separate in publish-tracepoint-staging-image.ps1; no image was built and no runtime was deployed.'
    return
}

Assert-TracePointStagingHostname -Hostname 'staging.tracepointhq.com'
if ($CertificateArn -notmatch "^arn:aws:acm:$region`:$account`:certificate/[0-9a-f-]+$") {
    throw 'CertificateArn must be an existing us-east-1 staging-account ACM certificate; this script never requests or modifies certificates or DNS.'
}
$digest = Get-ImmutableImage
Assert-RuntimeSecretConfiguration

$context = @('-c', "account=$account", '-c', "region=$region", '-c', "environment=$environment", '-c', 'runtimeEnabled=true', '-c', "certificateArn=$CertificateArn", '-c', "imageTag=$ImageTag", '--lookups=false')
Push-Location $infraRoot
try {
    $diff = & npx.cmd cdk diff $runtimeStack --profile $Profile @context 2>&1
    $diffExitCode = $LASTEXITCODE
}
finally { Pop-Location }
if ($diffExitCode -gt 1) { throw 'CDK diff failed; runtime was not deployed.' }
$diffText = $diff -join [Environment]::NewLine
if ($diffText -match '(?im)^\s*\[-\]|will be destroyed|requires replacement|\[~\].*replace|production|265544358665') {
    throw 'The runtime diff failed the deletion, replacement, or production-safety gate.'
}
Write-Host $diffText

Assert-TracePointStagingIdentity -Profile $Profile | Out-Null
Push-Location $infraRoot
try {
    & npx.cmd cdk deploy $runtimeStack --profile $Profile @context --require-approval never
    $deployExitCode = $LASTEXITCODE
}
finally { Pop-Location }
if ($deployExitCode -ne 0) { throw 'Staging runtime deployment failed.' }
$stack = Invoke-AwsJson @('cloudformation', 'describe-stacks', '--stack-name', $runtimeStack)
if ($stack.Stacks[0].StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')) { throw 'Staging runtime stack is not healthy after deployment.' }
Write-Host "Staging runtime deployed from immutable image $ImageTag ($digest). Image publication was not performed by this script."
