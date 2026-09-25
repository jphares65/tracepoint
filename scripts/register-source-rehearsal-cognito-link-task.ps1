$ErrorActionPreference = 'Stop'
$profile = 'tracepoint-production'
$region = 'us-east-1'
$source = (aws ecs describe-task-definition --task-definition 'tracepoint-production-source-rehearsal-identity-contract-20260925:2' --profile $profile --region $region --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or !$source) { throw 'SOURCE_TASK_LOOKUP_FAILED' }
$fixture = (aws ecs describe-task-definition --task-definition 'tracepoint-production-phase3c-rehearsal-fixture:10' --profile $profile --region $region --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or !$fixture) { throw 'FIXTURE_TASK_LOOKUP_FAILED' }
$expectedImage = '193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@sha256:32888e87d80a099e4711f7907521f95b2a4bb3bfff6fc4df9b7b39b2c140f52a'
if ($source.containerDefinitions[0].image -ne $expectedImage -or
    $fixture.executionRoleArn -ne 'arn:aws:iam::193644343389:role/TracePoint-Phase3cRehearsalFixtureExec' -or
    $fixture.taskRoleArn -ne 'arn:aws:iam::193644343389:role/TracePoint-Phase3cRehearsalFixtureTask') { throw 'TASK_LINEAGE_MISMATCH' }
$secret = @($fixture.containerDefinitions[0].secrets)
if ($secret.Count -ne 1 -or $secret[0].name -ne 'TRACEPOINT_DATABASE_SECRET_JSON' -or
    $secret[0].valueFrom -ne 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/rehearsal/database-fixture-4272874f-KnwdBw') { throw 'FIXTURE_SECRET_REFERENCE_MISMATCH' }
$code = Get-Content -LiteralPath 'scripts/source-rehearsal-cognito-link.cjs' -Raw
if ($code.Length -lt 8000 -or $code.Length -gt 15000) { throw 'LINK_CODE_SIZE_UNEXPECTED' }
$container = $source.containerDefinitions[0]
$container.entryPoint = @('node', '-e')
$container.command = @($code)
$container.environment = @(@{ name = 'TRACEPOINT_REHEARSAL_LINK_RUN'; value = 'on' })
$container.secrets = $secret
$request = @{
  family = 'tracepoint-production-source-rehearsal-cognito-link-20260925'
  taskRoleArn = $fixture.taskRoleArn
  executionRoleArn = $fixture.executionRoleArn
  networkMode = $source.networkMode
  containerDefinitions = @($container)
  requiresCompatibilities = $source.requiresCompatibilities
  cpu = $source.cpu
  memory = $source.memory
}
if ($source.runtimePlatform) { $request.runtimePlatform = $source.runtimePlatform }
$json = $request | ConvertTo-Json -Depth 50 -Compress
$requestFile = Join-Path ([System.IO.Path]::GetTempPath()) ('tracepoint-cognito-link-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [System.IO.File]::WriteAllText($requestFile, $json, [System.Text.UTF8Encoding]::new($false))
  aws ecs register-task-definition --cli-input-json ('file://' + $requestFile.Replace('\', '/')) --profile $profile --region $region --query 'taskDefinition.taskDefinitionArn' --output text
  if ($LASTEXITCODE -ne 0) { throw 'TASK_REGISTRATION_FAILED' }
} finally {
  Remove-Item -LiteralPath $requestFile -ErrorAction SilentlyContinue
}
