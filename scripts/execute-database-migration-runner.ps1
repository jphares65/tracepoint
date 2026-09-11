[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
    [Parameter(Mandatory)][guid]$RunId,
    [Parameter(Mandatory)][string]$AuthorizationReference,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
    [Parameter(Mandatory)][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ImageDigest,
    [Parameter(Mandatory)][string]$RepositoryName,
    [Parameter(Mandatory)][string]$ClusterName,
    [Parameter(Mandatory)][string]$VpcId,
    [Parameter(Mandatory)][string[]]$PublicSubnetIds,
    [Parameter(Mandatory)][string]$DatabaseSecurityGroupId,
    [Parameter(Mandatory)][string]$SourceSecretArn,
    [Parameter(Mandatory)][string]$TargetSecretArn,
    [Parameter(Mandatory)][ValidatePattern('^[a-z]{20}$')][string]$SourceProjectRef,
    [Parameter(Mandatory)][string]$TargetHost,
    [Parameter(Mandatory)][string]$CostEvidencePath,
    [Parameter(Mandatory)][string]$EvidenceOutputPath,
    [ValidateRange(1,100000)][decimal]$ApprovedBudgetLimitUSD = 125,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$account = if ($Environment -eq 'staging') { '559054714699' } else { (& aws.exe sts get-caller-identity --query Account --output text) }
$identity = & aws.exe sts get-caller-identity --region $region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -cne $account) { throw 'AWS identity does not match the migration account.' }
if ($Environment -eq 'production' -and $identity.Arn -notmatch "^arn:aws:sts::$account`:assumed-role/TracePointMigrationProduction/") { throw 'The exact production migration role is required.' }
if ($PublicSubnetIds.Count -ne 2 -or ($PublicSubnetIds | Select-Object -Unique).Count -ne 2) { throw 'Exactly two reviewed public subnets are required.' }
$cost = Get-Content -Raw -LiteralPath $CostEvidencePath | ConvertFrom-Json
$costAgeHours = (Get-Date).ToUniversalTime().Subtract([datetime]$cost.queriedAtUTC).TotalHours
if (($Environment -eq 'staging' -and $ApprovedBudgetLimitUSD -ne 125) -or $cost.account -cne $account -or $cost.budgetLimitUSD -ne $ApprovedBudgetLimitUSD -or $cost.withinCeiling -ne $true -or $costAgeHours -lt 0 -or $costAgeHours -gt 24) { throw 'Fresh cost evidence within the approved ceiling is required.' }
$image = & aws.exe ecr describe-images --region $region --repository-name $RepositoryName --image-ids "imageTag=$Commit-postgres-migration" --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $image.imageDetails.Count -ne 1 -or $image.imageDetails[0].imageDigest -cne $ImageDigest -or $image.imageDetails[0].imageScanStatus.status -cne 'COMPLETE') { throw 'Immutable migration image or scan evidence is invalid.' }
$findings = $image.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
if (($findings.CRITICAL ?? 0) -ne 0 -or ($findings.HIGH ?? 0) -ne 0) { throw 'Migration image has disallowed vulnerability findings.' }

$stack = "tracepoint-$Environment-database-migration-$RunId"
$contexts = @(
    '-c', "environment=$Environment", '-c', "account=$account", '-c', "region=$region", '-c', "runId=$RunId",
    '-c', "authorizationReference=$AuthorizationReference", '-c', "commit=$Commit", '-c', "imageDigest=$ImageDigest",
    '-c', "repositoryName=$RepositoryName", '-c', "clusterName=$ClusterName", '-c', "vpcId=$VpcId",
    '-c', "publicSubnetIds=$($PublicSubnetIds -join ',')", '-c', "databaseSecurityGroupId=$DatabaseSecurityGroupId",
    '-c', "sourceSecretArn=$SourceSecretArn", '-c', "targetSecretArn=$TargetSecretArn",
    '-c', "sourceHost=db.$SourceProjectRef.supabase.co", '-c', "sourceProjectRef=$SourceProjectRef", '-c', 'sourceDatabase=postgres',
    '-c', "targetHost=$TargetHost", '-c', 'targetDatabase=tracepoint'
)
Push-Location (Join-Path $PSScriptRoot '..\infra')
try {
    & npx.cmd cdk synth $stack --app 'npx ts-node --prefer-ts-exts bin/database-migration-runner.ts' @contexts --quiet | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Migration runner synthesis failed.' }
    if (-not $Execute) { Write-Host "Validated migration runner plan $RunId. No AWS resource was changed."; return }
    if ($env:TRACEPOINT_DATABASE_MIGRATION_AUTHORIZATION -cne "$AuthorizationReference`:$RunId") { throw 'Run-specific migration authorization is required.' }
    & npx.cmd cdk deploy $stack --app 'npx ts-node --prefer-ts-exts bin/database-migration-runner.ts' @contexts --require-approval never --outputs-file (Join-Path $env:TEMP "$stack-outputs.json") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Migration runner deployment failed.' }
} finally { Pop-Location }
$outputs = Get-Content -Raw -LiteralPath (Join-Path $env:TEMP "$stack-outputs.json") | ConvertFrom-Json
$taskDefinition = $outputs.$stack.TaskDefinitionArn
$runnerSecurityGroup = $outputs.$stack.RunnerSecurityGroupId
$network = "awsvpcConfiguration={subnets=[$($PublicSubnetIds -join ',')],securityGroups=[$runnerSecurityGroup],assignPublicIp=ENABLED}"
$taskArn = & aws.exe ecs run-task --region $region --cluster $ClusterName --task-definition $taskDefinition --launch-type FARGATE --count 1 --network-configuration $network --query 'tasks[0].taskArn' --output text
if ($LASTEXITCODE -ne 0 -or $taskArn -notmatch '^arn:aws:ecs:') { throw 'Migration task did not start.' }
& aws.exe ecs wait tasks-stopped --region $region --cluster $ClusterName --tasks $taskArn
$task = & aws.exe ecs describe-tasks --region $region --cluster $ClusterName --tasks $taskArn --output json | ConvertFrom-Json
$container = $task.tasks[0].containers | Where-Object { $_.name -eq 'migration' } | Select-Object -First 1
if ($LASTEXITCODE -ne 0 -or $container.exitCode -ne 0) { throw 'Migration task failed; inspect the retained sanitized log group.' }
$taskId = ($taskArn -split '/')[-1]
$logGroup = "/tracepoint/$Environment/database-migration/$RunId"
$logStream = "runner/migration/$taskId"
$messages = & aws.exe logs get-log-events --region $region --log-group-name $logGroup --log-stream-name $logStream --query 'events[].message' --output json | ConvertFrom-Json
$databaseEvidence = $messages | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_.status -eq 'PASSED' -and $_.runId -eq $RunId.ToString() } | Select-Object -Last 1
if ($LASTEXITCODE -ne 0 -or -not $databaseEvidence -or $databaseEvidence.sourceManifestSha256 -notmatch '^[0-9a-f]{64}$' -or $databaseEvidence.targetManifestSha256 -cne $databaseEvidence.sourceManifestSha256 -or $databaseEvidence.sourceMigrationLedgerSha256 -notmatch '^[0-9a-f]{64}$' -or $databaseEvidence.migrationLedgerSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Exact database reconciliation evidence was not produced.' }
$evidence = [ordered]@{ format=1; runId=$RunId.ToString(); account=$account; environment=$Environment; commit=$Commit; imageDigest=$ImageDigest; taskDefinitionArn=$taskDefinition; taskArn=$taskArn; exitCode=$container.exitCode; stoppedAt=$task.tasks[0].stoppedAt; database=$databaseEvidence; costEvidencePath=$CostEvidencePath }
$json = $evidence | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Resolve-Path -LiteralPath (Split-Path -Parent $EvidenceOutputPath)).Path + [System.IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $EvidenceOutputPath), $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host "Migration task completed; sanitized launch evidence was written to $EvidenceOutputPath. Database reconciliation evidence remains in its retained CloudWatch log stream."
