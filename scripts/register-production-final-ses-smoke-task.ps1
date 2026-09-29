param([ValidateSet('send','audit')][string] $Mode,
      [string] $MessageId = '', [string] $Profile = 'tracepoint-production')
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$account = '193644343389'
$image = "$account.dkr.ecr.$region.amazonaws.com/tracepoint-production@sha256:89ef6188d0bce79a741a3cf53b2d59826cd2491710c20d81dc6d3f90c2564cef"
$role = "arn:aws:iam::$account`:role/tracepoint-production-aws-native-proof-task-v1"
$execution = "arn:aws:iam::$account`:role/tracepoint-production-aws-native-proof-execution-v1"
$secret = "arn:aws:secretsmanager:$region`:$account`:secret:tracepoint/production/final/database-runtime-20260926-yg23sb"
if ($Mode -eq 'audit' -and $MessageId -notmatch '^[A-Za-z0-9_-]{1,256}$') { throw 'SES_AUDIT_MESSAGE_ID_INVALID' }
$native = (aws ecs describe-task-definition --task-definition 'tracepoint-production-aws-native-no-traffic-proof:1' --profile $Profile --region $region --output json | ConvertFrom-Json).taskDefinition
$import = (aws ecs describe-task-definition --task-definition 'tracepoint-production-final-relational-import-20260928:2' --profile $Profile --region $region --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or $native.taskRoleArn -ne $role -or $native.executionRoleArn -ne $execution -or
    @($native.containerDefinitions[0].secrets | Where-Object { $_.name -eq 'TRACEPOINT_DATABASE_SECRET_JSON' -and $_.valueFrom -eq $secret }).Count -ne 1 -or
    $import.containerDefinitions[0].image -ne $image) { throw 'FINAL_SES_RUNTIME_PIN_MISMATCH' }
$code = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'production-final-ses-feedback-smoke.cjs') -Raw
if ($code.Length -lt 5000 -or $code.Length -gt 15000) { throw 'SES_SMOKE_CODE_SIZE_UNEXPECTED' }
$environment = @(
  @{ name = 'TRACEPOINT_FINAL_SES_SMOKE'; value = $Mode },
  @{ name = 'TRACEPOINT_AWS_ACCOUNT_ID'; value = $account }
)
if ($Mode -eq 'audit') { $environment += @{ name = 'TRACEPOINT_FINAL_SES_MESSAGE_ID'; value = $MessageId } }
$definition = @{
  family = "tracepoint-production-final-ses-smoke-$Mode-20260928"
  taskRoleArn = $role
  executionRoleArn = $execution
  networkMode = 'awsvpc'
  requiresCompatibilities = @('FARGATE')
  cpu = '512'
  memory = '1024'
  containerDefinitions = @(@{
    name = 'final-ses-smoke'
    image = $image
    essential = $true
    entryPoint = @('node', '-e')
    command = @($code)
    environment = $environment
    secrets = @(@{ name = 'TRACEPOINT_DATABASE_SECRET_JSON'; valueFrom = $secret })
    logConfiguration = @{ logDriver = 'awslogs'; options = @{
      'awslogs-group' = '/tracepoint/production/application'
      'awslogs-region' = $region
      'awslogs-stream-prefix' = 'final-ses-smoke'
    } }
  })
}
$file = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-final-ses-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($file, ($definition | ConvertTo-Json -Depth 30 -Compress), [Text.UTF8Encoding]::new($false))
  aws ecs register-task-definition --cli-input-json ('file://' + $file.Replace('\', '/')) --profile $Profile --region $region --query 'taskDefinition.{arn:taskDefinitionArn,role:taskRoleArn,execution:executionRoleArn,image:containerDefinitions[0].image}' --output json
  if ($LASTEXITCODE -ne 0) { throw 'SES_SMOKE_TASK_REGISTRATION_FAILED' }
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
