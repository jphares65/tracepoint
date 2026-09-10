[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
    [Parameter(Mandatory)][guid]$RunId,
    [Parameter(Mandatory)][guid]$ActorUserId,
    [Parameter(Mandatory)][guid]$DepartmentId,
    [string]$AfterUserId = '',
    [Parameter(Mandatory)][string]$AuthorizationReference,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
    [Parameter(Mandatory)][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ImageDigest,
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
    [Parameter(Mandatory)][string]$BuildEvidencePath,
    [Parameter(Mandatory)][string]$CostEvidencePath,
    [Parameter(Mandatory)][string]$ManifestOutputPath,
    [string[]]$StagingRecipientSha256 = @(),
    [ValidateRange(1,100000)][decimal]$ApprovedBudgetLimitUSD = 75,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'; $repositoryName = "tracepoint-$Environment"
$account = if ($Environment -eq 'staging') { '559054714699' } else { (& aws.exe sts get-caller-identity --query Account --output text) }
$identity = & aws.exe sts get-caller-identity --region $region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -cne $account) { throw 'AWS identity does not match the identity-preparation account.' }
if ($Environment -eq 'production' -and $identity.Arn -notmatch "^arn:aws:sts::$account`:assumed-role/TracePointMigrationProduction/") { throw 'The exact production migration role is required.' }
if ($ClusterName -cne "tracepoint-$Environment" -or $PublicSubnetIds.Count -ne 2 -or ($PublicSubnetIds | Select-Object -Unique).Count -ne 2) { throw 'The exact TracePoint cluster and two reviewed public subnets are required.' }
if ($Environment -eq 'staging' -and ($StagingRecipientSha256.Count -lt 1 -or $StagingRecipientSha256.Count -gt 100 -or @($StagingRecipientSha256 | Where-Object { $_ -notmatch '^[0-9a-f]{64}$' }).Count -ne 0)) { throw 'Reviewed staging recipient hashes are required.' }
if ($Environment -eq 'production' -and $StagingRecipientSha256.Count -ne 0) { throw 'Staging recipient hashes cannot be supplied to production.' }
if ($AfterUserId -and $AfterUserId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'The identity cursor must be a UUID.' }
$cost = Get-Content -Raw -LiteralPath $CostEvidencePath | ConvertFrom-Json; $costAge = (Get-Date).ToUniversalTime().Subtract([datetime]$cost.queriedAtUTC).TotalHours
if (($Environment -eq 'staging' -and $ApprovedBudgetLimitUSD -ne 75) -or $cost.account -cne $account -or $cost.budgetLimitUSD -ne $ApprovedBudgetLimitUSD -or $cost.withinCeiling -ne $true -or $costAge -lt 0 -or $costAge -gt 24) { throw 'Fresh cost evidence within the approved ceiling is required.' }
$buildEvidence = Get-Content -Raw -LiteralPath $BuildEvidencePath | ConvertFrom-Json
if ($buildEvidence.account -cne $account -or $buildEvidence.commit -cne $Commit -or $buildEvidence.imageDigest -cne $ImageDigest -or $buildEvidence.buildStatus -cne 'SUCCEEDED' -or $buildEvidence.scanStatus -cne 'COMPLETE' -or $buildEvidence.sourceArchiveSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Identity image build provenance evidence is invalid.' }
$build = & aws.exe codebuild batch-get-builds --region $region --ids $buildEvidence.buildId --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $build.builds.Count -ne 1 -or $build.builds[0].buildStatus -cne 'SUCCEEDED' -or $build.builds[0].sourceVersion -cne $buildEvidence.sourceVersion) { throw 'Identity CodeBuild provenance is invalid.' }
$image = & aws.exe ecr describe-images --region $region --repository-name $repositoryName --image-ids "imageTag=$Commit-identity-migration" --output json | ConvertFrom-Json
$findings = $image.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
if ($LASTEXITCODE -ne 0 -or $image.imageDetails[0].imageDigest -cne $ImageDigest -or $image.imageDetails[0].imageScanStatus.status -cne 'COMPLETE' -or ($findings.CRITICAL ?? 0) -ne 0 -or ($findings.HIGH ?? 0) -ne 0) { throw 'Identity image digest or scan evidence is invalid.' }
$cluster = & aws.exe ecs describe-clusters --region $region --clusters $ClusterName --output json | ConvertFrom-Json
$repository = & aws.exe ecr describe-repositories --region $region --repository-names $repositoryName --output json | ConvertFrom-Json
$vpc = & aws.exe ec2 describe-vpcs --region $region --vpc-ids $VpcId --output json | ConvertFrom-Json
$subnets = & aws.exe ec2 describe-subnets --region $region --subnet-ids $PublicSubnetIds --output json | ConvertFrom-Json
$group = & aws.exe ec2 describe-security-groups --region $region --group-ids $DatabaseSecurityGroupId --output json | ConvertFrom-Json
$secret = & aws.exe secretsmanager describe-secret --region $region --secret-id $DatabaseSecretArn --output json | ConvertFrom-Json
$bucketEncryption = & aws.exe s3api get-bucket-encryption --region $region --bucket $ArtifactBucketName --output json | ConvertFrom-Json
$bucketVersioning = & aws.exe s3api get-bucket-versioning --region $region --bucket $ArtifactBucketName --output json | ConvertFrom-Json
$pool = & aws.exe cognito-idp describe-user-pool --region $region --user-pool-id $UserPoolId --output json | ConvertFrom-Json
$poolClient = & aws.exe cognito-idp describe-user-pool-client --region $region --user-pool-id $UserPoolId --client-id $ClientId --output json | ConvertFrom-Json
if ($cluster.clusters.Count -ne 1 -or $cluster.clusters[0].status -cne 'ACTIVE' -or $repository.repositories[0].repositoryArn -cne "arn:aws:ecr:$region`:$account`:repository/$repositoryName" -or $repository.repositories[0].imageTagMutability -cne 'IMMUTABLE' -or $vpc.Vpcs.Count -ne 1 -or $vpc.Vpcs[0].CidrBlock -cne '10.40.0.0/16' -or $subnets.Subnets.Count -ne 2 -or @($subnets.Subnets | Where-Object { $_.VpcId -cne $VpcId -or $_.MapPublicIpOnLaunch -ne $true }).Count -ne 0 -or $group.SecurityGroups[0].VpcId -cne $VpcId -or $secret.Name -cne "tracepoint/$Environment/database/runtime" -or $secret.KmsKeyId -cne $ArtifactKeyArn -or $ArtifactBucketName -cne "tracepoint-$Environment-private-$account" -or $bucketEncryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID -cne $ArtifactKeyArn -or $bucketVersioning.Status -cne 'Enabled' -or $pool.UserPool.Name -cne "tracepoint-$Environment" -or $poolClient.UserPoolClient.ClientId -cne $ClientId) { throw 'Identity preparation resources do not match the TracePoint foundation.' }

$stack = "tracepoint-$Environment-identity-prepare-$RunId"; $artifactPrefix = "migration/identity/$RunId"
$contexts = @('-c',"environment=$Environment",'-c','mode=prepare','-c',"account=$account",'-c',"region=$region",'-c',"runId=$RunId",'-c',"actorUserId=$ActorUserId",'-c',"departmentId=$DepartmentId",'-c',"authorizationReference=$AuthorizationReference",'-c','manifestSha256=','-c',"commit=$Commit",'-c',"imageDigest=$ImageDigest",'-c',"repositoryName=$repositoryName",'-c',"clusterName=$ClusterName",'-c',"vpcId=$VpcId",'-c',"publicSubnetIds=$($PublicSubnetIds -join ',')",'-c',"databaseSecurityGroupId=$DatabaseSecurityGroupId",'-c',"databaseSecretArn=$DatabaseSecretArn",'-c',"artifactBucketName=$ArtifactBucketName",'-c',"artifactKeyArn=$ArtifactKeyArn",'-c',"userPoolId=$UserPoolId",'-c',"clientId=$ClientId",'-c',"fromAddress=$FromAddress",'-c',"sesConfigurationSet=$SesConfigurationSet",'-c',"stagingRecipientSha256=$($StagingRecipientSha256 -join ',')")
if ($AfterUserId) { $contexts += @('-c',"afterUserId=$AfterUserId") }
Push-Location (Join-Path $PSScriptRoot '..\infra')
try {
    & npx.cmd cdk synth $stack --app 'npx ts-node --prefer-ts-exts bin/identity-migration-runner.ts' @contexts --quiet | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Identity preparation synthesis failed.' }
    if (-not $Execute) { Write-Host "Validated private identity preparation $RunId. No AWS resource was changed."; return }
    & npx.cmd cdk deploy $stack --app 'npx ts-node --prefer-ts-exts bin/identity-migration-runner.ts' @contexts --require-approval never --outputs-file (Join-Path $env:TEMP "$stack-outputs.json") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Identity preparation deployment failed.' }
} finally { Pop-Location }
$outputs = Get-Content -Raw -LiteralPath (Join-Path $env:TEMP "$stack-outputs.json") | ConvertFrom-Json; $taskDefinition = $outputs.$stack.TaskDefinitionArn; $runnerGroup = $outputs.$stack.RunnerSecurityGroupId
$network = "awsvpcConfiguration={subnets=[$($PublicSubnetIds -join ',')],securityGroups=[$runnerGroup],assignPublicIp=ENABLED}"
$taskArn = & aws.exe ecs run-task --region $region --cluster $ClusterName --task-definition $taskDefinition --launch-type FARGATE --count 1 --network-configuration $network --query 'tasks[0].taskArn' --output text
if ($LASTEXITCODE -ne 0 -or $taskArn -notmatch '^arn:aws:ecs:') { throw 'Identity preparation task did not start.' }
$stopped = $false
for ($attempt=0; $attempt -lt 70; $attempt++) { $status = & aws.exe ecs describe-tasks --region $region --cluster $ClusterName --tasks $taskArn --query 'tasks[0].lastStatus' --output text; if ($status -eq 'STOPPED') { $stopped=$true; break }; Start-Sleep -Seconds 10 }
if (-not $stopped) { & aws.exe ecs stop-task --region $region --cluster $ClusterName --task $taskArn --reason 'Guarded identity preparation deadline exceeded' | Out-Null; & aws.exe ecs wait tasks-stopped --region $region --cluster $ClusterName --tasks $taskArn; throw 'Identity preparation exceeded its deadline and was stopped.' }
$task = & aws.exe ecs describe-tasks --region $region --cluster $ClusterName --tasks $taskArn --output json | ConvertFrom-Json; $container = $task.tasks[0].containers | Where-Object { $_.name -eq 'migration' } | Select-Object -First 1
if ($container.exitCode -ne 0) { throw 'Identity preparation task failed.' }
& aws.exe s3api get-object --region $region --bucket $ArtifactBucketName --key "$artifactPrefix/manifest.json" $ManifestOutputPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Prepared identity manifest could not be downloaded.' }
$manifest = Get-Content -Raw -LiteralPath $ManifestOutputPath | ConvertFrom-Json
if ($manifest.environment -cne $Environment -or $manifest.expectedAccount -cne $account -or $manifest.authorizationReference -cne $AuthorizationReference -or $manifest.contentSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Prepared identity artifact is invalid.' }
if ($manifest.PSObject.Properties.Name -contains 'kind' -and $manifest.kind -eq 'identity-batch-complete') {
    if ($manifest.departmentId -cne $DepartmentId.ToString() -or $manifest.afterUserId -cne $AfterUserId) { throw 'Identity completion scope is invalid.' }
    Write-Host "Verified that the department has no additional eligible Cognito identities after the reviewed cursor. No Cognito user or email was changed."
} else {
    if ($manifest.users.Count -lt 1 -or $manifest.users.Count -gt 100) { throw 'Prepared identity manifest is invalid.' }
    Write-Host "Prepared a private, department-scoped identity manifest for $($manifest.users.Count) users. No Cognito user or email was changed."
}
