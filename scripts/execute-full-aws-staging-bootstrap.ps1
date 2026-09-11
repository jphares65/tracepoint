[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][string]$ExpiresAfterUtc,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 .@_-]{2,79}$')][string]$LeaseOwner,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$')][string]$LeaseReference,
    [string]$EvidenceOutputPath,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$infra = Join-Path $root 'infra'
$stack = 'tracepoint-staging-database-bootstrap'
$assembly = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-db-bootstrap-' + [guid]::NewGuid().ToString('N'))
$contexts = @(
    '-c', 'account=559054714699', '-c', 'region=us-east-1', '-c', 'environment=tracepoint-staging',
    '-c', 'providerMode=aws-native', '-c', 'databaseEnabled=true', '-c', "databaseExpiresAfterUtc=$ExpiresAfterUtc",
    '-c', "databaseLeaseOwner=$LeaseOwner", '-c', "databaseLeaseReference=$LeaseReference",
    '-c', 'privateStorageEnabled=true', '-c', 'storageProvider=s3', '-c', 'databaseBootstrapEnabled=true',
    '-c', "bootstrapSourceCommit=$SourceCommit", '--lookups=false'
)

Push-Location $infra
try {
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & npx.cmd cdk synth $stack @contexts --strict --quiet --output $assembly
        $synthExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($synthExitCode -ne 0) { throw 'AWS-native database bootstrap synthesis failed.' }
} finally { Pop-Location }

if (-not $Execute) {
    Write-Host 'Validated the immutable AWS-native database bootstrap task. No AWS resource or database was changed.'
    return
}

$model = Get-Content -Raw -LiteralPath (Join-Path $root 'docs/aws-native-staging-cost-model-20260910.json') | ConvertFrom-Json
$incremental = ($model.incrementalComponentsCents.PSObject.Properties.Value | Measure-Object -Sum).Sum
$projected = [int]$model.baselineModelCents + [int]$incremental
if ($projected -ne [int]$model.projectedTotalCents -or $model.withinApprovedCeiling -ne $true -or $projected -gt 7500) {
    throw "Projected full-AWS staging cost is $([math]::Round($projected / 100, 2)) USD/month, above the authorized 75 USD ceiling. No AWS mutation was attempted."
}
Assert-TracePointStagingIdentity | Out-Null
$budget = & aws.exe budgets describe-budget --account-id 559054714699 --budget-name tracepoint-staging-monthly-75 --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'The staging budget cannot be verified.' }
$budget = ($budget -join [Environment]::NewLine) | ConvertFrom-Json
if ([decimal]$budget.Budget.BudgetLimit.Amount -ne 75 -or $budget.Budget.BudgetLimit.Unit -ne 'USD') { throw 'The exact 75 USD staging budget is required.' }

$toolingTag = "$SourceCommit-postgres-migration"
$image = & aws.exe ecr describe-images --repository-name tracepoint-staging --image-ids "imageTag=$toolingTag" --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'The immutable PostgreSQL tooling image is unavailable.' }
$image = ($image -join [Environment]::NewLine) | ConvertFrom-Json
if (@($image.imageDetails).Count -ne 1 -or $image.imageDetails[0].imageScanStatus.status -ne 'COMPLETE') { throw 'The PostgreSQL tooling image has no complete scan.' }
$findings = $image.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
if (($findings.CRITICAL ?? 0) -ne 0 -or ($findings.HIGH ?? 0) -ne 0) { throw 'The PostgreSQL tooling image has disallowed scan findings.' }

$outputsPath = Join-Path ([IO.Path]::GetTempPath()) ("$stack-outputs-" + [guid]::NewGuid().ToString('N') + '.json')
Push-Location $infra
try {
    Assert-TracePointStagingIdentity | Out-Null
    & npx.cmd cdk deploy $stack @contexts --require-approval never --outputs-file $outputsPath
    if ($LASTEXITCODE -ne 0) { throw 'Database bootstrap runner deployment failed.' }
} finally { Pop-Location }
$outputs = Get-Content -Raw -LiteralPath $outputsPath | ConvertFrom-Json
$taskDefinition = $outputs.$stack.TaskDefinitionArn
$subnets = @($outputs.$stack.PublicSubnetIds -split ',')
$securityGroup = $outputs.$stack.RunnerSecurityGroupId
if ($subnets.Count -ne 2 -or $securityGroup -notmatch '^sg-[0-9a-f]+$') { throw 'Bootstrap runner network outputs are invalid.' }
$network = "awsvpcConfiguration={subnets=[$($subnets -join ',')],securityGroups=[$securityGroup],assignPublicIp=ENABLED}"
Assert-TracePointStagingIdentity | Out-Null
$taskArn = & aws.exe ecs run-task --cluster tracepoint-staging --task-definition $taskDefinition --launch-type FARGATE --count 1 --network-configuration $network --region us-east-1 --query 'tasks[0].taskArn' --output text
if ($LASTEXITCODE -ne 0 -or $taskArn -notmatch '^arn:aws:ecs:us-east-1:559054714699:task/') { throw 'Database bootstrap task did not start.' }
& aws.exe ecs wait tasks-stopped --cluster tracepoint-staging --tasks $taskArn --region us-east-1
if ($LASTEXITCODE -ne 0) { throw 'Database bootstrap task wait failed.' }
$task = & aws.exe ecs describe-tasks --cluster tracepoint-staging --tasks $taskArn --region us-east-1 --output json | ConvertFrom-Json
$container = @($task.tasks[0].containers | Where-Object name -eq 'bootstrap')
if ($container.Count -ne 1 -or $container[0].exitCode -ne 0) { throw 'Database bootstrap failed; inspect the sanitized staging log stream.' }
$taskId = ($taskArn -split '/')[-1]
$stream = "database-bootstrap/bootstrap/$taskId"
$messages = & aws.exe logs get-log-events --log-group-name /tracepoint/staging/app --log-stream-name $stream --region us-east-1 --query 'events[].message' --output json | ConvertFrom-Json
$result = $messages | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object status -eq 'PASSED' | Select-Object -Last 1
if (-not $result -or $result.sourceMigrations -ne 76 -or $result.awsMigrations -ne 17 -or $result.runtimeRoleVerified -ne $true -or $result.supabaseAuthorizationReferences -ne 0) { throw 'Exact database bootstrap evidence was not produced.' }
if ($EvidenceOutputPath) {
    $parent = Split-Path -Parent $EvidenceOutputPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Evidence output directory must already exist.' }
    $evidence = [ordered]@{ format=1; account='559054714699'; sourceCommit=$SourceCommit; taskDefinitionArn=$taskDefinition; taskArn=$taskArn; stoppedAt=$task.tasks[0].stoppedAt; result=$result; valuesPrinted=$false }
    [IO.File]::WriteAllText((Join-Path (Resolve-Path -LiteralPath $parent).Path (Split-Path -Leaf $EvidenceOutputPath)), ($evidence | ConvertTo-Json -Depth 4) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}
Write-Host 'AWS-native staging database bootstrap completed with 76 source and 17 AWS compatibility migrations; no credential values were printed.'
