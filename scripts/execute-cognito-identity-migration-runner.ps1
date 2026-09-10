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
    [Parameter(Mandatory)][string]$DatabaseSecretArn,
    [Parameter(Mandatory)][string]$ApplicationSecretArn,
    [Parameter(Mandatory)][string]$ArtifactBucketName,
    [Parameter(Mandatory)][string]$ArtifactKeyArn,
    [Parameter(Mandatory)][string]$UserPoolId,
    [Parameter(Mandatory)][string]$ClientId,
    [Parameter(Mandatory)][string]$FromAddress,
    [Parameter(Mandatory)][string]$SesConfigurationSet,
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$CostEvidencePath,
    [Parameter(Mandatory)][string]$EvidenceOutputPath,
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
$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.environment -cne $Environment -or $manifest.expectedAccount -cne $account -or $manifest.authorizationReference -cne $AuthorizationReference -or $manifest.userPoolId -cne $UserPoolId -or $manifest.clientId -cne $ClientId -or $manifest.contentSha256 -notmatch '^[0-9a-f]{64}$' -or [datetime]$manifest.expiresAt -le (Get-Date).ToUniversalTime()) { throw 'Identity manifest does not match this execution or has expired.' }
$cost = Get-Content -Raw -LiteralPath $CostEvidencePath | ConvertFrom-Json
$expectedBudget = if ($Environment -eq 'staging') { 75 } else { 150 }
if ($cost.account -cne $account -or $cost.budgetLimitUSD -ne $expectedBudget -or $cost.withinCeiling -ne $true -or (Get-Date).ToUniversalTime().Subtract([datetime]$cost.queriedAtUTC).TotalHours -gt 24) { throw 'Fresh cost evidence within the approved ceiling is required.' }
$image = & aws.exe ecr describe-images --region $region --repository-name $RepositoryName --image-ids "imageTag=$Commit-identity-migration" --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $image.imageDetails.Count -ne 1 -or $image.imageDetails[0].imageDigest -cne $ImageDigest -or $image.imageDetails[0].imageScanStatus.status -cne 'COMPLETE') { throw 'Immutable identity migration image or scan evidence is invalid.' }
$findings = $image.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
if (($findings.CRITICAL ?? 0) -ne 0 -or ($findings.HIGH ?? 0) -ne 0) { throw 'Identity migration image has disallowed vulnerability findings.' }

$stack = "tracepoint-$Environment-identity-migration-$RunId"
$artifactPrefix = "migration/identity/$RunId"
$contexts = @(
    '-c', "environment=$Environment", '-c', "account=$account", '-c', "region=$region", '-c', "runId=$RunId",
    '-c', "authorizationReference=$AuthorizationReference", '-c', "manifestSha256=$($manifest.contentSha256)", '-c', "commit=$Commit", '-c', "imageDigest=$ImageDigest",
    '-c', "repositoryName=$RepositoryName", '-c', "clusterName=$ClusterName", '-c', "vpcId=$VpcId", '-c', "publicSubnetIds=$($PublicSubnetIds -join ',')",
    '-c', "databaseSecurityGroupId=$DatabaseSecurityGroupId", '-c', "databaseSecretArn=$DatabaseSecretArn", '-c', "applicationSecretArn=$ApplicationSecretArn",
    '-c', "artifactBucketName=$ArtifactBucketName", '-c', "artifactKeyArn=$ArtifactKeyArn", '-c', "userPoolId=$UserPoolId", '-c', "clientId=$ClientId",
    '-c', "fromAddress=$FromAddress", '-c', "sesConfigurationSet=$SesConfigurationSet"
)
Push-Location (Join-Path $PSScriptRoot '..\infra')
try {
    & npx.cmd cdk synth $stack --app 'npx ts-node --prefer-ts-exts bin/identity-migration-runner.ts' @contexts --quiet | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Identity migration runner synthesis failed.' }
    if (-not $Execute) { Write-Host "Validated identity migration runner plan $RunId. No AWS resource was changed."; return }
    if ($env:TRACEPOINT_IDENTITY_MIGRATION_AUTHORIZATION -cne "$AuthorizationReference`:$($manifest.contentSha256)") { throw 'Manifest-specific identity migration authorization is required.' }
    & npx.cmd cdk deploy $stack --app 'npx ts-node --prefer-ts-exts bin/identity-migration-runner.ts' @contexts --require-approval never --outputs-file (Join-Path $env:TEMP "$stack-outputs.json") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Identity migration runner deployment failed.' }
} finally { Pop-Location }

& aws.exe s3api put-object --region $region --bucket $ArtifactBucketName --key "$artifactPrefix/manifest.json" --body $ManifestPath --server-side-encryption aws:kms --ssekms-key-id $ArtifactKeyArn --content-type application/json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Encrypted identity manifest upload failed.' }
$outputs = Get-Content -Raw -LiteralPath (Join-Path $env:TEMP "$stack-outputs.json") | ConvertFrom-Json
$taskDefinition = $outputs.$stack.TaskDefinitionArn
$runnerSecurityGroup = $outputs.$stack.RunnerSecurityGroupId
$network = "awsvpcConfiguration={subnets=[$($PublicSubnetIds -join ',')],securityGroups=[$runnerSecurityGroup],assignPublicIp=ENABLED}"
$taskArn = & aws.exe ecs run-task --region $region --cluster $ClusterName --task-definition $taskDefinition --launch-type FARGATE --count 1 --network-configuration $network --query 'tasks[0].taskArn' --output text
if ($LASTEXITCODE -ne 0 -or $taskArn -notmatch '^arn:aws:ecs:') { throw 'Identity migration task did not start.' }
& aws.exe ecs wait tasks-stopped --region $region --cluster $ClusterName --tasks $taskArn
$task = & aws.exe ecs describe-tasks --region $region --cluster $ClusterName --tasks $taskArn --output json | ConvertFrom-Json
$container = $task.tasks[0].containers | Where-Object { $_.name -eq 'migration' } | Select-Object -First 1
if ($LASTEXITCODE -ne 0 -or $container.exitCode -ne 0) { throw 'Identity migration task failed; inspect the retained sanitized log group.' }
$downloadPath = Join-Path $env:TEMP "$stack-evidence.json"
& aws.exe s3api get-object --region $region --bucket $ArtifactBucketName --key "$artifactPrefix/evidence.json" $downloadPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Identity migration evidence was not produced.' }
$identityEvidence = Get-Content -Raw -LiteralPath $downloadPath | ConvertFrom-Json
if ($identityEvidence.manifestSha256 -cne $manifest.contentSha256 -or $identityEvidence.reconciliationSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Identity reconciliation evidence is invalid.' }
$evidence = [ordered]@{ format=1; runId=$RunId.ToString(); account=$account; environment=$Environment; commit=$Commit; imageDigest=$ImageDigest; taskDefinitionArn=$taskDefinition; taskArn=$taskArn; exitCode=$container.exitCode; stoppedAt=$task.tasks[0].stoppedAt; identity=$identityEvidence; costEvidencePath=$CostEvidencePath }
$json = $evidence | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Resolve-Path -LiteralPath (Split-Path -Parent $EvidenceOutputPath)).Path + [System.IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $EvidenceOutputPath), $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Remove-Item -LiteralPath $downloadPath -Force
Write-Host "Identity migration task completed; sanitized evidence was written to $EvidenceOutputPath."
