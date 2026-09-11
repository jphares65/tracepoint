[CmdletBinding()]
param(
    [ValidateSet('ValidateImplementation','DeployFoundations','DeployRuntime')][string]$Action = 'ValidateImplementation',
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [string]$ExpiresAfterUtc = (Get-Date).ToUniversalTime().AddDays(2).ToString('yyyy-MM-ddTHH:mm:ssZ'),
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 .@_-]{2,79}$')][string]$LeaseOwner = 'tracepoint-engineering',
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$')][string]$LeaseReference = 'implementation-validation',
    [string]$CertificateArn = 'arn:aws:acm:us-east-1:559054714699:certificate/00000000-0000-4000-8000-000000000000',
    [ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ImageDigest = ('sha256:' + ('0' * 64)),
    [ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ToolingImageDigest = ('sha256:' + ('0' * 64)),
    [string]$BootstrapEvidencePath,
    [string]$SecretInitializationAuthorizationReference,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$infra = Join-Path $root 'infra'
$assembly = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-full-aws-staging-' + [guid]::NewGuid().ToString('N'))
$nativeImageTag = "$SourceCommit-aws-native"
$contexts = @(
    '-c', 'account=559054714699', '-c', 'region=us-east-1', '-c', 'environment=tracepoint-staging',
    '-c', 'providerMode=aws-native', '-c', 'databaseEnabled=true', '-c', "databaseExpiresAfterUtc=$ExpiresAfterUtc",
    '-c', "databaseLeaseOwner=$LeaseOwner", '-c', "databaseLeaseReference=$LeaseReference",
    '-c', 'privateStorageEnabled=true', '-c', 'storageProvider=s3', '-c', 'databaseBootstrapEnabled=true',
    '-c', "bootstrapSourceCommit=$SourceCommit", '-c', "bootstrapImageDigest=$ToolingImageDigest", '-c', 'runtimeEnabled=true', '-c', "imageTag=$nativeImageTag",
    '-c', "imageDigest=$ImageDigest",
    '-c', "certificateArn=$CertificateArn", '--lookups=false'
)

if ($CertificateArn -notmatch '^arn:aws:acm:us-east-1:559054714699:certificate/[0-9a-f-]{36}$') { throw 'Exact staging certificate ARN required.' }
Push-Location $infra
try {
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & npx.cmd cdk synth @contexts --strict --quiet --output $assembly
        $synthExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($synthExitCode -ne 0) { throw 'Full-AWS staging strict synthesis failed.' }
} finally { Pop-Location }
& node (Join-Path $PSScriptRoot 'validate-full-aws-staging-assembly.mjs') $assembly $SourceCommit $ImageDigest $ToolingImageDigest
if ($LASTEXITCODE -ne 0) { throw 'Full-AWS staging structural validation failed.' }
if ($Action -eq 'ValidateImplementation' -or -not $Execute) {
    Write-Host 'Full-AWS staging implementation synthesized and passed provider-isolation checks. No AWS resource was changed.'
    return
}

$model = Get-Content -Raw -LiteralPath (Join-Path $root 'docs/aws-native-staging-cost-model-20260910.json') | ConvertFrom-Json
$projected = ($model.componentsCents.PSObject.Properties.Value | Measure-Object -Sum).Sum
if ($projected -ne [int]$model.projectedTotalCents -or [int]$model.ceilingCents -ne 12500 -or
    [int]$model.headroomCents -ne (12500 - $projected) -or $model.withinApprovedCeiling -ne $true -or $projected -gt 12500) {
    throw "Projected full-AWS staging cost is $([math]::Round($projected / 100, 2)) USD/month and does not satisfy the authorized 125 USD ceiling. No AWS mutation was attempted."
}
Assert-TracePointStagingIdentity | Out-Null
$budget = & aws.exe budgets describe-budget --account-id 559054714699 --budget-name tracepoint-staging-monthly-125 --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'The staging budget cannot be verified.' }
$budget = ($budget -join [Environment]::NewLine) | ConvertFrom-Json
if ([decimal]$budget.Budget.BudgetLimit.Amount -ne 125 -or $budget.Budget.BudgetLimit.Unit -ne 'USD') { throw 'The exact 125 USD staging budget is required.' }

if ($Action -eq 'DeployFoundations') {
    if ([string]::IsNullOrWhiteSpace($SecretInitializationAuthorizationReference) -or
        $env:TRACEPOINT_SECRET_INITIALIZATION_AUTHORIZATION -cne $SecretInitializationAuthorizationReference) {
        throw 'Run-bound AWS-native secret initialization authorization is required.'
    }
    $foundationStacks = @(
        'tracepoint-staging-network', 'tracepoint-staging-security', 'tracepoint-staging-compute',
        'tracepoint-staging-aws-native-image-build', 'tracepoint-staging-storage', 'tracepoint-staging-database', 'tracepoint-staging-backup',
        'tracepoint-staging-ses-foundation', 'tracepoint-staging-cognito', 'tracepoint-staging-ses-feedback-worker'
    )
    Push-Location $infra
    try {
        Assert-TracePointStagingIdentity | Out-Null
        & npx.cmd cdk deploy @foundationStacks @contexts --require-approval never
        if ($LASTEXITCODE -ne 0) { throw 'Full-AWS staging foundation deployment failed.' }
    } finally { Pop-Location }
    & node (Join-Path $PSScriptRoot 'initialize-aws-native-application-secret.mjs') --execute --environment staging --expected-account 559054714699 --secret-id tracepoint/staging/application/aws-native --authorization-reference $SecretInitializationAuthorizationReference
    if ($LASTEXITCODE -ne 0) { throw 'AWS-native staging secret initialization failed.' }
    Write-Host 'Full-AWS staging foundations deployed and the isolated AWS-native application secret initialized.'
    return
}

if (-not (Test-Path -LiteralPath $BootstrapEvidencePath -PathType Leaf)) { throw 'A completed database bootstrap evidence file is required before runtime deployment.' }
$bootstrap = Get-Content -Raw -LiteralPath $BootstrapEvidencePath | ConvertFrom-Json
if ($bootstrap.account -ne '559054714699' -or $bootstrap.sourceCommit -ne $SourceCommit -or $bootstrap.toolingImageDigest -ne $ToolingImageDigest -or $bootstrap.result.sourceMigrations -ne 76 -or
    $bootstrap.result.awsMigrations -ne 17 -or $bootstrap.result.runtimeRoleVerified -ne $true -or $bootstrap.result.supabaseAuthorizationReferences -ne 0) {
    throw 'Database bootstrap evidence does not match this immutable release.'
}
$secretText = & aws.exe secretsmanager get-secret-value --secret-id tracepoint/staging/application/aws-native --query SecretString --output text --region us-east-1 2>&1
if ($LASTEXITCODE -ne 0) { throw 'AWS-native staging secret is unavailable.' }
try {
    $secretText | & node (Join-Path $PSScriptRoot 'validate-aws-native-application-secret.mjs') staging
    if ($LASTEXITCODE -ne 0) { throw 'AWS-native staging secret validation failed.' }
} finally { $secretText = $null }
$image = & aws.exe ecr describe-images --repository-name tracepoint-staging --image-ids "imageTag=$nativeImageTag" --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'The immutable AWS-native runtime image is unavailable.' }
$image = ($image -join [Environment]::NewLine) | ConvertFrom-Json
if (@($image.imageDetails).Count -ne 1 -or $image.imageDetails[0].imageDigest -cne $ImageDigest -or $image.imageDetails[0].imageScanStatus.status -ne 'COMPLETE') { throw 'AWS-native runtime image digest or scan is invalid.' }
$findings = $image.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
if (($findings.CRITICAL ?? 0) -ne 0 -or ($findings.HIGH ?? 0) -ne 0) { throw 'AWS-native runtime image has disallowed scan findings.' }
$previous = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
if ($LASTEXITCODE -ne 0 -or $previous -notmatch '^arn:aws:ecs:us-east-1:559054714699:task-definition/') { throw 'A retained bridge task revision is required for rollback.' }
$previousDefinitionText = & aws.exe ecs describe-task-definition --task-definition $previous --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'The retained bridge task definition cannot be inspected.' }
try {
    $previousDefinitionText | & node (Join-Path $PSScriptRoot 'validate-staging-bridge-rollback-target.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'The retained task is not an isolated bridge rollback target.' }
} finally { $previousDefinitionText = $null }
try {
    Push-Location $infra
    try {
        Assert-TracePointStagingIdentity | Out-Null
        & npx.cmd cdk deploy tracepoint-staging-runtime @contexts --exclusively --require-approval never
        if ($LASTEXITCODE -ne 0) { throw 'AWS-native staging runtime deployment failed.' }
    } finally { Pop-Location }
    & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
    if ($LASTEXITCODE -ne 0) { throw 'AWS-native staging runtime did not stabilize.' }
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
} catch {
    $failure = $_
    $current = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
    if ($LASTEXITCODE -ne 0) { throw 'Native release failed and the current task cannot be inspected; manual staging recovery is required.' }
    if ($current -ne $previous) {
        & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $previous -Execute
        & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
        if ($LASTEXITCODE -ne 0) { throw 'Bridge rollback did not stabilize; manual recovery is required.' }
        & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
    }
    throw $failure
}
Write-Host "AWS-native staging runtime deployed from immutable image $nativeImageTag; retained bridge task $previous remains the rollback source."
