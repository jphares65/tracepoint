[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$AuthorizationReference,
    [string]$EvidenceOutputPath,
    [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$validation = & node.exe (Join-Path $PSScriptRoot 'validate-full-aws-production-cutover.mjs') $ManifestPath
if ($LASTEXITCODE -ne 0) { throw 'The immutable full-AWS cutover manifest failed validation.' }
$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
if ($manifest.evidence.authorizationReference -cne $AuthorizationReference) { throw 'Owner authorization reference does not match the immutable manifest.' }
if ($manifest.evidence.awsAcceptedWrites -ne $false) { throw 'Automatic rollback is prohibited after AWS-native writes. Freeze both systems and reconcile target deltas.' }

$identity = (& aws.exe sts get-caller-identity --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $identity.Account -cne $manifest.evidence.account) { throw 'AWS identity does not match the reviewed production account.' }
$expectedRole = "arn:aws:iam::$($manifest.evidence.account):role/TracePointMigrationProduction"
if ($identity.Arn -notmatch "^arn:aws:sts::$($manifest.evidence.account):assumed-role/TracePointMigrationProduction/") { throw "The exact production migration role is required: $expectedRole" }

Write-Host "Validated pre-write rollback manifest $($manifest.contentSha256). No change has been made."
if (-not $Execute) { return }
$serviceBefore = & aws.exe ecs describe-services --region $manifest.evidence.region --cluster $manifest.evidence.service.cluster --services $manifest.evidence.service.name --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $serviceBefore.services.Count -ne 1 -or $serviceBefore.failures.Count -ne 0 -or $serviceBefore.services[0].taskDefinition -cne $manifest.evidence.awsTaskDefinitionArn) { throw 'The service is not running the reviewed AWS-native task definition.' }
$nativeTask = (& aws.exe ecs describe-task-definition --region $manifest.evidence.region --task-definition $manifest.evidence.awsTaskDefinitionArn --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or $nativeTask.status -cne 'ACTIVE' -or $nativeTask.taskDefinitionArn -cne $manifest.evidence.awsTaskDefinitionArn) { throw 'The immutable AWS-native task definition could not be verified.' }
$nativeContainer = @($nativeTask.containerDefinitions) | Where-Object { $_.name -eq 'app' } | Select-Object -First 1
if (-not $nativeContainer -or $nativeContainer.image -notmatch '^[0-9]{12}\.dkr\.ecr\.us-east-1\.amazonaws\.com/(?<nativeRepository>[a-z0-9._/-]+):(?<nativeTag>[a-z0-9._-]+)$') { throw 'The AWS-native task image reference is invalid.' }
$nativeDigest = & aws.exe ecr describe-images --region $manifest.evidence.region --repository-name $Matches.nativeRepository --image-ids "imageTag=$($Matches.nativeTag)" --query 'imageDetails[0].imageDigest' --output text
if ($LASTEXITCODE -ne 0 -or $nativeDigest -cne $manifest.evidence.awsImageDigest) { throw 'The active AWS-native task image does not match the immutable manifest.' }
$task = (& aws.exe ecs describe-task-definition --region $manifest.evidence.region --task-definition $manifest.evidence.bridgeTaskDefinitionArn --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or $task.status -cne 'ACTIVE' -or $task.taskDefinitionArn -cne $manifest.evidence.bridgeTaskDefinitionArn) { throw 'The immutable bridge task definition could not be verified.' }
$container = @($task.containerDefinitions) | Where-Object { $_.name -eq 'app' } | Select-Object -First 1
if (-not $container -or $container.image -notmatch '^[0-9]{12}\.dkr\.ecr\.us-east-1\.amazonaws\.com/(?<repository>[a-z0-9._/-]+):(?<tag>[a-z0-9._-]+)$') { throw 'The bridge task image reference is invalid.' }
$digest = & aws.exe ecr describe-images --region $manifest.evidence.region --repository-name $Matches.repository --image-ids "imageTag=$($Matches.tag)" --query 'imageDetails[0].imageDigest' --output text
if ($LASTEXITCODE -ne 0 -or $digest -cne $manifest.evidence.bridgeImageDigest) { throw 'The bridge task image does not match the immutable manifest.' }
$scan = & aws.exe ecr describe-images --region $manifest.evidence.region --repository-name $Matches.repository --image-ids "imageDigest=$digest" --output json | ConvertFrom-Json
$severity = $scan.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
if ($LASTEXITCODE -ne 0 -or $scan.imageDetails[0].imageScanStatus.status -cne 'COMPLETE' -or ($severity.CRITICAL ?? 0) -ne 0 -or ($severity.HIGH ?? 0) -ne 0) { throw 'The bridge image scan is incomplete or has disallowed findings.' }
if (-not (@($container.secrets) | Where-Object { $_.valueFrom -like "$($manifest.evidence.bridgeApplicationSecret.arn)*" })) { throw 'The bridge task is not bound to the preserved bridge secret.' }
$currentBridgeVersion = & aws.exe secretsmanager get-secret-value --region $manifest.evidence.region --secret-id $manifest.evidence.bridgeApplicationSecret.arn --version-stage AWSCURRENT --query VersionId --output text
if ($LASTEXITCODE -ne 0) { throw 'The preserved bridge secret version could not be verified.' }
if ($currentBridgeVersion -cne $manifest.evidence.bridgeApplicationSecret.versionId) {
    & aws.exe secretsmanager update-secret-version-stage --region $manifest.evidence.region --secret-id $manifest.evidence.bridgeApplicationSecret.arn --version-stage AWSCURRENT --move-to-version-id $manifest.evidence.bridgeApplicationSecret.versionId --remove-from-version-id $currentBridgeVersion | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The preserved bridge secret version could not be restored.' }
}
& aws.exe ecs update-service --region $manifest.evidence.region --cluster $manifest.evidence.service.cluster --service $manifest.evidence.service.name --task-definition $manifest.evidence.bridgeTaskDefinitionArn --output json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ECS rejected the rollback task update.' }
& aws.exe ecs wait services-stable --region $manifest.evidence.region --cluster $manifest.evidence.service.cluster --services $manifest.evidence.service.name
if ($LASTEXITCODE -ne 0) { throw 'The bridge task did not stabilize.' }
$serviceAfter = & aws.exe ecs describe-services --region $manifest.evidence.region --cluster $manifest.evidence.service.cluster --services $manifest.evidence.service.name --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $serviceAfter.services[0].taskDefinition -cne $manifest.evidence.bridgeTaskDefinitionArn -or $serviceAfter.services[0].runningCount -ne $serviceAfter.services[0].desiredCount -or $serviceAfter.services[0].pendingCount -ne 0) { throw 'The bridge service did not reach its exact reviewed state.' }
$health = Invoke-RestMethod -Uri "https://$($manifest.evidence.hostname)/api/health" -Method Get -TimeoutSec 15 -MaximumRedirection 0 -Headers @{ 'Cache-Control'='no-store' }
if ($health.status -cne 'ok' -or $health.service -cne 'tracepoint') { throw 'The restored bridge did not pass its public health probe.' }
if ($EvidenceOutputPath) {
    $evidence = [ordered]@{ format=1; manifestSha256=$manifest.contentSha256; authorizationReference=$AuthorizationReference; account=$manifest.evidence.account; service=$manifest.evidence.service; restoredTaskDefinitionArn=$manifest.evidence.bridgeTaskDefinitionArn; bridgeImageDigest=$digest; runningCount=$serviceAfter.services[0].runningCount; desiredCount=$serviceAfter.services[0].desiredCount; healthPassed=$true; completedAt=(Get-Date).ToUniversalTime().ToString('o'); customerDataMoved=$false }
    $parent = Resolve-Path -LiteralPath (Split-Path -Parent $EvidenceOutputPath)
    [System.IO.File]::WriteAllText($parent.Path + [System.IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $EvidenceOutputPath), ($evidence | ConvertTo-Json -Depth 4) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}
Write-Host 'The immutable bridge task stabilized. Both databases and all migration manifests remain preserved.'
