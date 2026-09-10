[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$AuthorizationReference,
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
$task = (& aws.exe ecs describe-task-definition --region $manifest.evidence.region --task-definition $manifest.evidence.bridgeTaskDefinitionArn --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or $task.status -cne 'ACTIVE' -or $task.taskDefinitionArn -cne $manifest.evidence.bridgeTaskDefinitionArn) { throw 'The immutable bridge task definition could not be verified.' }
$container = @($task.containerDefinitions) | Where-Object { $_.name -eq 'app' } | Select-Object -First 1
if (-not $container -or $container.image -notmatch '^[0-9]{12}\.dkr\.ecr\.us-east-1\.amazonaws\.com/(?<repository>[a-z0-9._/-]+):(?<tag>[a-z0-9._-]+)$') { throw 'The bridge task image reference is invalid.' }
$digest = & aws.exe ecr describe-images --region $manifest.evidence.region --repository-name $Matches.repository --image-ids "imageTag=$($Matches.tag)" --query 'imageDetails[0].imageDigest' --output text
if ($LASTEXITCODE -ne 0 -or $digest -cne $manifest.evidence.bridgeImageDigest) { throw 'The bridge task image does not match the immutable manifest.' }
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
Write-Host 'The immutable bridge task stabilized. Both databases and all migration manifests remain preserved.'
