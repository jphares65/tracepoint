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
    [Parameter(Mandatory)][string]$ArtifactBucketName,
    [Parameter(Mandatory)][string]$ArtifactKeyArn,
    [Parameter(Mandatory)][string]$UserPoolId,
    [Parameter(Mandatory)][string]$ClientId,
    [Parameter(Mandatory)][string]$FromAddress,
    [Parameter(Mandatory)][string]$SesConfigurationSet,
    [string[]]$StagingRecipientSha256 = @(),
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$BuildEvidencePath,
    [Parameter(Mandatory)][string]$CostEvidencePath,
    [Parameter(Mandatory)][string]$EvidenceOutputPath,
    [ValidateRange(1,100000)][decimal]$ApprovedBudgetLimitUSD = 75,
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
if ($RepositoryName -cne "tracepoint-$Environment" -or $ClusterName -cne "tracepoint-$Environment") { throw 'Identity runner foundation names are invalid.' }
if ($Environment -eq 'staging' -and ($StagingRecipientSha256.Count -lt 1 -or $StagingRecipientSha256.Count -gt 100 -or @($StagingRecipientSha256 | Where-Object { $_ -notmatch '^[0-9a-f]{64}$' }).Count -ne 0)) { throw 'Reviewed staging recipient hashes are required.' }
if ($Environment -eq 'production' -and $StagingRecipientSha256.Count -ne 0) { throw 'Staging recipient hashes cannot be supplied to production.' }
$cluster = & aws.exe ecs describe-clusters --region $region --clusters $ClusterName --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $cluster.clusters.Count -ne 1 -or $cluster.failures.Count -ne 0 -or $cluster.clusters[0].status -cne 'ACTIVE' -or $cluster.clusters[0].clusterArn -cne "arn:aws:ecs:$region`:$account`:cluster/$ClusterName") { throw 'The exact TracePoint ECS cluster is required.' }
$repository = & aws.exe ecr describe-repositories --region $region --repository-names $RepositoryName --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $repository.repositories.Count -ne 1 -or $repository.repositories[0].repositoryArn -cne "arn:aws:ecr:$region`:$account`:repository/$RepositoryName" -or $repository.repositories[0].imageTagMutability -cne 'IMMUTABLE' -or $repository.repositories[0].imageScanningConfiguration.scanOnPush -ne $true) { throw 'The exact immutable TracePoint ECR repository is required.' }
$vpc = & aws.exe ec2 describe-vpcs --region $region --vpc-ids $VpcId --output json | ConvertFrom-Json
$vpcName = @($vpc.Vpcs[0].Tags | Where-Object { $_.Key -eq 'Name' } | Select-Object -ExpandProperty Value)
if ($LASTEXITCODE -ne 0 -or $vpc.Vpcs.Count -ne 1 -or $vpc.Vpcs[0].CidrBlock -cne '10.40.0.0/16' -or $vpcName -notcontains "tracepoint-$Environment") { throw 'The exact TracePoint VPC is required.' }
$subnets = & aws.exe ec2 describe-subnets --region $region --subnet-ids $PublicSubnetIds --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $subnets.Subnets.Count -ne 2 -or @($subnets.Subnets | Where-Object { $_.VpcId -cne $VpcId -or $_.MapPublicIpOnLaunch -ne $true -or @($_.Tags | Where-Object { $_.Key -eq 'aws-cdk:subnet-name' -and $_.Value -eq 'public-ingress' }).Count -ne 1 }).Count -ne 0) { throw 'Both exact TracePoint public subnets are required.' }
$databaseSecurityGroup = & aws.exe ec2 describe-security-groups --region $region --group-ids $DatabaseSecurityGroupId --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $databaseSecurityGroup.SecurityGroups.Count -ne 1 -or $databaseSecurityGroup.SecurityGroups[0].VpcId -cne $VpcId -or $databaseSecurityGroup.SecurityGroups[0].Description -cne 'TracePoint PostgreSQL accepts TLS clients only from the application task security group') { throw 'The exact TracePoint database security group is required.' }
$databaseSecret = & aws.exe secretsmanager describe-secret --region $region --secret-id $DatabaseSecretArn --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $databaseSecret.ARN -cne $DatabaseSecretArn -or $databaseSecret.Name -cne "tracepoint/$Environment/database/runtime" -or $databaseSecret.KmsKeyId -cne $ArtifactKeyArn) { throw 'The exact TracePoint runtime database secret and KMS key are required.' }
$bucketEncryption = & aws.exe s3api get-bucket-encryption --region $region --bucket $ArtifactBucketName --output json | ConvertFrom-Json
$bucketVersioning = & aws.exe s3api get-bucket-versioning --region $region --bucket $ArtifactBucketName --output json | ConvertFrom-Json
$bucketPublicAccess = & aws.exe s3api get-public-access-block --region $region --bucket $ArtifactBucketName --output json | ConvertFrom-Json
$encryptionRule = $bucketEncryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault
if ($ArtifactBucketName -cne "tracepoint-$Environment-private-$account" -or $encryptionRule.SSEAlgorithm -cne 'aws:kms' -or $encryptionRule.KMSMasterKeyID -cne $ArtifactKeyArn -or $bucketVersioning.Status -cne 'Enabled' -or @($bucketPublicAccess.PublicAccessBlockConfiguration.PSObject.Properties.Value | Where-Object { $_ -ne $true }).Count -ne 0) { throw 'The exact encrypted, versioned, private migration artifact bucket is required.' }
$pool = & aws.exe cognito-idp describe-user-pool --region $region --user-pool-id $UserPoolId --output json | ConvertFrom-Json
$poolClient = & aws.exe cognito-idp describe-user-pool-client --region $region --user-pool-id $UserPoolId --client-id $ClientId --output json | ConvertFrom-Json
$emailIdentity = & aws.exe sesv2 get-email-identity --region $region --email-identity ($FromAddress -split '@')[1] --output json | ConvertFrom-Json
& aws.exe sesv2 get-configuration-set --region $region --configuration-set-name $SesConfigurationSet --output json | Out-Null
if ($LASTEXITCODE -ne 0 -or $pool.UserPool.Name -cne "tracepoint-$Environment" -or $poolClient.UserPoolClient.UserPoolId -cne $UserPoolId -or $poolClient.UserPoolClient.ClientId -cne $ClientId -or $emailIdentity.VerificationStatus -cne 'SUCCESS') { throw 'The exact Cognito pool/client and verified SES identity are required.' }
$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.environment -cne $Environment -or $manifest.expectedAccount -cne $account -or $manifest.authorizationReference -cne $AuthorizationReference -or $manifest.userPoolId -cne $UserPoolId -or $manifest.clientId -cne $ClientId -or $manifest.contentSha256 -notmatch '^[0-9a-f]{64}$' -or [datetime]$manifest.expiresAt -le (Get-Date).ToUniversalTime()) { throw 'Identity manifest does not match this execution or has expired.' }
$cost = Get-Content -Raw -LiteralPath $CostEvidencePath | ConvertFrom-Json
$costAgeHours = (Get-Date).ToUniversalTime().Subtract([datetime]$cost.queriedAtUTC).TotalHours
if (($Environment -eq 'staging' -and $ApprovedBudgetLimitUSD -ne 75) -or $cost.account -cne $account -or $cost.budgetLimitUSD -ne $ApprovedBudgetLimitUSD -or $cost.withinCeiling -ne $true -or $costAgeHours -lt 0 -or $costAgeHours -gt 24) { throw 'Fresh cost evidence within the approved ceiling is required.' }
$image = & aws.exe ecr describe-images --region $region --repository-name $RepositoryName --image-ids "imageTag=$Commit-identity-migration" --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $image.imageDetails.Count -ne 1 -or $image.imageDetails[0].imageDigest -cne $ImageDigest -or $image.imageDetails[0].imageScanStatus.status -cne 'COMPLETE') { throw 'Immutable identity migration image or scan evidence is invalid.' }
$findings = $image.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
if (($findings.CRITICAL ?? 0) -ne 0 -or ($findings.HIGH ?? 0) -ne 0) { throw 'Identity migration image has disallowed vulnerability findings.' }
$buildEvidence = Get-Content -Raw -LiteralPath $BuildEvidencePath | ConvertFrom-Json
if ($buildEvidence.account -cne $account -or $buildEvidence.region -cne $region -or $buildEvidence.commit -cne $Commit -or $buildEvidence.imageTag -cne "$Commit-identity-migration" -or $buildEvidence.imageDigest -cne $ImageDigest -or $buildEvidence.buildStatus -cne 'SUCCEEDED' -or $buildEvidence.scanStatus -cne 'COMPLETE' -or $buildEvidence.sourceArchiveSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Identity image build provenance evidence is invalid.' }
$build = & aws.exe codebuild batch-get-builds --region $region --ids $buildEvidence.buildId --output json | ConvertFrom-Json
$commitOverride = @($build.builds[0].environment.environmentVariables | Where-Object { $_.name -eq 'SOURCE_COMMIT' } | Select-Object -ExpandProperty value)
if ($LASTEXITCODE -ne 0 -or $build.builds.Count -ne 1 -or $build.builds[0].buildStatus -cne 'SUCCEEDED' -or $build.builds[0].sourceVersion -cne $buildEvidence.sourceVersion -or $build.builds[0].buildspec -cne 'buildspec.identity-migration.yml' -or $commitOverride -notcontains $Commit) { throw 'The completed CodeBuild execution does not match the reviewed identity source.' }

$stack = "tracepoint-$Environment-identity-execute-$RunId"
$artifactPrefix = "migration/identity/$RunId"
$contexts = @(
    '-c', "environment=$Environment", '-c', 'mode=execute', '-c', "account=$account", '-c', "region=$region", '-c', "runId=$RunId",
    '-c', "authorizationReference=$AuthorizationReference", '-c', "manifestSha256=$($manifest.contentSha256)", '-c', "commit=$Commit", '-c', "imageDigest=$ImageDigest",
    '-c', "repositoryName=$RepositoryName", '-c', "clusterName=$ClusterName", '-c', "vpcId=$VpcId", '-c', "publicSubnetIds=$($PublicSubnetIds -join ',')",
    '-c', "databaseSecurityGroupId=$DatabaseSecurityGroupId", '-c', "databaseSecretArn=$DatabaseSecretArn",
    '-c', "artifactBucketName=$ArtifactBucketName", '-c', "artifactKeyArn=$ArtifactKeyArn", '-c', "userPoolId=$UserPoolId", '-c', "clientId=$ClientId",
    '-c', "fromAddress=$FromAddress", '-c', "sesConfigurationSet=$SesConfigurationSet", '-c', "stagingRecipientSha256=$($StagingRecipientSha256 -join ',')"
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
$stopped = $false
for ($attempt = 0; $attempt -lt 390; $attempt++) {
    $status = & aws.exe ecs describe-tasks --region $region --cluster $ClusterName --tasks $taskArn --query 'tasks[0].lastStatus' --output text
    if ($LASTEXITCODE -ne 0) { throw 'Identity migration task status could not be read.' }
    if ($status -eq 'STOPPED') { $stopped = $true; break }
    Start-Sleep -Seconds 10
}
if (-not $stopped) {
    & aws.exe ecs stop-task --region $region --cluster $ClusterName --task $taskArn --reason 'Guarded identity migration launcher deadline exceeded' | Out-Null
    & aws.exe ecs wait tasks-stopped --region $region --cluster $ClusterName --tasks $taskArn
    throw 'Identity migration exceeded its guarded deadline and was stopped before any retry.'
}
$task = & aws.exe ecs describe-tasks --region $region --cluster $ClusterName --tasks $taskArn --output json | ConvertFrom-Json
$container = $task.tasks[0].containers | Where-Object { $_.name -eq 'migration' } | Select-Object -First 1
if ($LASTEXITCODE -ne 0 -or $container.exitCode -ne 0) { throw 'Identity migration task failed; inspect the retained sanitized log group.' }
$downloadPath = Join-Path $env:TEMP "$stack-evidence.json"
& aws.exe s3api get-object --region $region --bucket $ArtifactBucketName --key "$artifactPrefix/evidence.json" $downloadPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Identity migration evidence was not produced.' }
$identityEvidence = Get-Content -Raw -LiteralPath $downloadPath | ConvertFrom-Json
if ($identityEvidence.manifestSha256 -cne $manifest.contentSha256 -or $identityEvidence.reconciliationSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Identity reconciliation evidence is invalid.' }
$evidence = [ordered]@{ format=1; runId=$RunId.ToString(); account=$account; environment=$Environment; commit=$Commit; imageDigest=$ImageDigest; sourceVersion=$buildEvidence.sourceVersion; sourceArchiveSha256=$buildEvidence.sourceArchiveSha256; buildId=$buildEvidence.buildId; taskDefinitionArn=$taskDefinition; taskArn=$taskArn; exitCode=$container.exitCode; stoppedAt=$task.tasks[0].stoppedAt; identity=$identityEvidence; costEvidencePath=$CostEvidencePath }
$json = $evidence | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Resolve-Path -LiteralPath (Split-Path -Parent $EvidenceOutputPath)).Path + [System.IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $EvidenceOutputPath), $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Remove-Item -LiteralPath $downloadPath -Force
Write-Host "Identity migration task completed; sanitized evidence was written to $EvidenceOutputPath."
