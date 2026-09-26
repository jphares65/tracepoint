$ErrorActionPreference = 'Stop'
$profile = 'tracepoint-production'
$region = 'us-east-1'
$base = (aws ecs describe-task-definition --task-definition 'tracepoint-production-phase3b-shadow:18' --profile $profile --region $region --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0) { throw 'SHADOW_TASK_UNAVAILABLE' }
$expectedImage = '193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@sha256:c9c65145196573ae8a007d4b5a3db4835df09c519b683d3a03fa384ad9c3b644'
if ($base.containerDefinitions.Count -ne 1 -or $base.containerDefinitions[0].image -ne $expectedImage -or
    $base.taskRoleArn -ne 'arn:aws:iam::193644343389:role/tracepoint-production-phase3b-shad-TaskRole30FC0FBB-E4XGnEPJO9DP') {
  throw 'SHADOW_TASK_IDENTITY_MISMATCH'
}
$container = $base.containerDefinitions[0]
$container.entryPoint = @('/nodejs/bin/node')
$container.command = @('-e', (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'shadow-s3-kms-default-probe.cjs') -Raw))
$container.secrets = @()
$container.environment = @(@{ name = 'AWS_REGION'; value = $region })
$request = @{
  family = 'tracepoint-production-phase3b-s3-kms-default-probe-20260926'
  taskRoleArn = $base.taskRoleArn
  executionRoleArn = $base.executionRoleArn
  networkMode = $base.networkMode
  containerDefinitions = @($container)
  volumes = $base.volumes
  requiresCompatibilities = $base.requiresCompatibilities
  cpu = $base.cpu
  memory = $base.memory
}
if ($base.runtimePlatform) { $request.runtimePlatform = $base.runtimePlatform }
$path = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-shadow-s3-probe-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($path, ($request | ConvertTo-Json -Depth 60 -Compress), [Text.UTF8Encoding]::new($false))
  $definition = (aws ecs register-task-definition --cli-input-json ('file://' + $path.Replace('\','/')) --profile $profile --region $region --output json | ConvertFrom-Json).taskDefinition
  if ($LASTEXITCODE -ne 0 -or $definition.family -ne $request.family) { throw 'PROBE_TASK_REGISTRATION_FAILED' }
  $network = 'awsvpcConfiguration={subnets=[subnet-0f4cbed3e60d90bfc],securityGroups=[sg-00e20852f41c35e5f],assignPublicIp=ENABLED}'
  $launch = aws ecs run-task --cluster tracepoint-production --task-definition $definition.taskDefinitionArn --launch-type FARGATE --count 1 --network-configuration $network --profile $profile --region $region --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $launch.failures.Count -ne 0 -or $launch.tasks.Count -ne 1) { throw 'PROBE_LAUNCH_FAILED' }
  $taskArn = $launch.tasks[0].taskArn
  aws ecs wait tasks-stopped --cluster tracepoint-production --tasks $taskArn --profile $profile --region $region
  if ($LASTEXITCODE -ne 0) { throw 'PROBE_WAIT_FAILED' }
  $finished = (aws ecs describe-tasks --cluster tracepoint-production --tasks $taskArn --profile $profile --region $region --output json | ConvertFrom-Json).tasks[0]
  if ($LASTEXITCODE -ne 0) { throw 'PROBE_RESULT_UNAVAILABLE' }
  Write-Output ("SHADOW_S3_PROBE_TASK={0};EXIT={1};STOP={2}" -f $taskArn,$finished.containers[0].exitCode,$finished.stoppedReason)
  if ($finished.containers[0].exitCode -ne 0) { throw 'SHADOW_S3_KMS_PROBE_FAILED' }
} finally {
  Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue
}
