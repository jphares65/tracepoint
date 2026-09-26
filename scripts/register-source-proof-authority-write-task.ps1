param([ValidateSet('preflight', 'aws-write')][string]$Mode = 'preflight')
$ErrorActionPreference = 'Stop'
$source = (aws ecs describe-task-definition --task-definition tracepoint-production-source-proof-atomic-replay-20260925:5 --profile tracepoint-production --region us-east-1 --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0) { throw 'SOURCE_TASK_LOOKUP_FAILED' }
$code = Get-Content -LiteralPath 'scripts/source-proof-authority-write.cjs' -Raw
if ($code.Length -lt 8000 -or $code.Length -gt 16000) { throw 'WRITE_CODE_SIZE_UNEXPECTED' }
$container = $source.containerDefinitions[0]
$container.entryPoint = @('node', '-e')
$container.command = @($code)
$container.environment = @(
  @{ name = 'TARGET_PGHOST'; value = 'tracepoint-production-source-proof-20260925.c8r4sgs089tu.us-east-1.rds.amazonaws.com' },
  @{ name = 'SOURCE_PROOF_ROLLBACK_MODE'; value = $Mode }
)
$request = @{
  family = 'tracepoint-production-source-proof-authority-write-20260925'
  taskRoleArn = $source.taskRoleArn
  executionRoleArn = $source.executionRoleArn
  networkMode = $source.networkMode
  containerDefinitions = @($container)
  requiresCompatibilities = $source.requiresCompatibilities
  cpu = $source.cpu
  memory = $source.memory
}
if ($source.runtimePlatform) { $request.runtimePlatform = $source.runtimePlatform }
$json = $request | ConvertTo-Json -Depth 50 -Compress
aws ecs register-task-definition --cli-input-json $json --profile tracepoint-production --region us-east-1 --query 'taskDefinition.taskDefinitionArn' --output text
if ($LASTEXITCODE -ne 0) { throw 'TASK_REGISTRATION_FAILED' }
