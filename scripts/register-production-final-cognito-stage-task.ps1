param([string] $Profile = 'tracepoint-production', [ValidateSet('preflight','on')][string] $Mode = 'preflight')
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$account = '193644343389'
$image = "$account.dkr.ecr.$region.amazonaws.com/tracepoint-production@sha256:89ef6188d0bce79a741a3cf53b2d59826cd2491710c20d81dc6d3f90c2564cef"
$role = "arn:aws:iam::$account`:role/tracepoint-production-aws-native-proof-task-v1"
$execution = "arn:aws:iam::$account`:role/TracePoint-ProductionFinalImportExec-20260928"
$secret = "arn:aws:secretsmanager:$region`:$account`:secret:tracepoint/production/database/migrator-8X57JT"
$exec = (aws ecs describe-task-definition --task-definition 'tracepoint-production-final-relational-import-20260928:2' --profile $Profile --region $region --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or $exec.containerDefinitions[0].image -ne $image -or
    $exec.executionRoleArn -ne $execution -or
    @($exec.containerDefinitions[0].secrets).Count -ne 1 -or
    $exec.containerDefinitions[0].secrets[0].valueFrom -ne $secret) { throw 'FINAL_IMPORT_SECRET_WIRING_MISMATCH' }
$codePath = Join-Path $PSScriptRoot 'production-final-cognito-stage-link.cjs'
$code = Get-Content -LiteralPath $codePath -Raw
if ($code.Length -lt 7000 -or $code.Length -gt 20000) { throw 'STAGING_CODE_SIZE_UNEXPECTED' }
$definition = @{
  family = "tracepoint-production-final-cognito-$Mode-20260928"
  taskRoleArn = $role
  executionRoleArn = $execution
  networkMode = 'awsvpc'
  requiresCompatibilities = @('FARGATE')
  cpu = '512'
  memory = '1024'
  containerDefinitions = @(@{
    name = 'final-cognito-stage-link'
    image = $image
    essential = $true
    entryPoint = @('node', '-e')
    command = @($code)
    environment = @(
      @{ name = 'TRACEPOINT_FINAL_COGNITO_STAGE'; value = $Mode },
      @{ name = 'TRACEPOINT_AWS_ACCOUNT_ID'; value = $account },
      @{ name = 'TRACEPOINT_COGNITO_USER_POOL_ID'; value = 'us-east-1_diFmWDMe9' }
    )
    secrets = @(@{ name = 'TARGET_DATABASE_SECRET_JSON'; valueFrom = $secret })
    logConfiguration = @{ logDriver = 'awslogs'; options = @{
      'awslogs-group' = '/tracepoint/production/final-import-20260928'
      'awslogs-region' = $region
      'awslogs-stream-prefix' = 'cognito'
    } }
  })
}
$file = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-final-cognito-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($file, ($definition | ConvertTo-Json -Depth 30 -Compress), [Text.UTF8Encoding]::new($false))
  aws ecs register-task-definition --cli-input-json ('file://' + $file.Replace('\', '/')) --profile $Profile --region $region --query 'taskDefinition.{arn:taskDefinitionArn,role:taskRoleArn,execution:executionRoleArn,image:containerDefinitions[0].image}' --output json
  if ($LASTEXITCODE -ne 0) { throw 'COGNITO_TASK_REGISTRATION_FAILED' }
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
