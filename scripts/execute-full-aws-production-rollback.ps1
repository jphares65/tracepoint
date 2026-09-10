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
& aws.exe ecs update-service --region $manifest.evidence.region --cluster $manifest.evidence.service.cluster --service $manifest.evidence.service.name --task-definition $manifest.evidence.bridgeTaskDefinitionArn --output json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ECS rejected the rollback task update.' }
& aws.exe ecs wait services-stable --region $manifest.evidence.region --cluster $manifest.evidence.service.cluster --services $manifest.evidence.service.name
if ($LASTEXITCODE -ne 0) { throw 'The bridge task did not stabilize.' }
Write-Host 'The immutable bridge task stabilized. Both databases and all migration manifests remain preserved.'

