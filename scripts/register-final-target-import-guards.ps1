$ErrorActionPreference = 'Stop'
$family = 'tracepoint-production-final-target-import-guards-20260926'
$base = (aws ecs describe-task-definition --task-definition 'tracepoint-production-final-target-schema-prep-20260926:1' --profile tracepoint-production --region us-east-1 --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0) { throw 'BASE_TASK_UNAVAILABLE' }
if ($base.taskRoleArn -ne 'arn:aws:iam::193644343389:role/TracePoint-RestRdsImportTask-4272874f') { throw 'UNEXPECTED_TASK_ROLE' }
$container = $base.containerDefinitions[0]
if ($container.image -ne '193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@sha256:7617c1c543e5ff17b1215fb9882f22b557ce4becb2a9acbd874c4012420260de' -or $container.user -ne '65532') { throw 'UNEXPECTED_IMAGE_OR_USER' }
if ($container.secrets.Count -ne 1 -or $container.secrets[0].name -ne 'TARGET_DATABASE_SECRET_JSON') { throw 'UNEXPECTED_SECRET_INJECTION' }
$container.entryPoint = @('/nodejs/bin/node')
$container.command = @('-e', (Get-Content -LiteralPath 'scripts/final-target-fixed-import-guards.cjs' -Raw))
$guardJson = node -e "import('./scripts/supabase-rest-import-core.mjs').then(m=>console.log(JSON.stringify(m.MIGRATION_MODE_TARGET_FUNCTIONS.map(x=>({name:x.name??x.functionName,statement:x.statement,requiredExistingFragments:x.requiredExistingFragments})))))"
if ($LASTEXITCODE -ne 0 -or -not $guardJson) { throw 'GUARD_CONTRACT_UNAVAILABLE' }
$guardHash = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($guardJson))) -Algorithm SHA256).Hash.ToLowerInvariant()
if ($guardHash -ne '17aae6542472fe6369c81f565bc06988b4fed5fce2507ba3b3ae7bfe1ad1c3a6') { throw 'GUARD_CONTRACT_CHANGED' }
$container.environment = @(@{ name = 'TRACEPOINT_GUARD_DEFINITIONS_B64'; value = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($guardJson)) })
$request = @{
  family = $family
  taskRoleArn = $base.taskRoleArn
  executionRoleArn = $base.executionRoleArn
  networkMode = $base.networkMode
  containerDefinitions = @($container)
  requiresCompatibilities = $base.requiresCompatibilities
  cpu = $base.cpu
  memory = $base.memory
}
if ($base.runtimePlatform) { $request.runtimePlatform = $base.runtimePlatform }
$requestFile = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-final-guards-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($requestFile, ($request | ConvertTo-Json -Depth 50 -Compress), [Text.UTF8Encoding]::new($false))
  aws ecs register-task-definition --cli-input-json ('file://' + $requestFile.Replace('\', '/')) --profile tracepoint-production --region us-east-1 --query 'taskDefinition.taskDefinitionArn' --output text
  if ($LASTEXITCODE -ne 0) { throw 'TASK_REGISTRATION_FAILED' }
} finally {
  Remove-Item -LiteralPath $requestFile -ErrorAction SilentlyContinue
}
