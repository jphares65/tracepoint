$ErrorActionPreference = 'Stop'
$code = Get-Content -LiteralPath 'scripts/source-proof-post-replay-compare.cjs' -Raw
if ($code.Length -lt 4000 -or $code.Length -gt 16000) { throw 'COMPARE_CODE_SIZE_UNEXPECTED' }
$path = 'infra/source-proof-post-replay-compare-task.json'
$request = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
if ($request.family -ne 'tracepoint-production-source-proof-post-replay-compare-20260926' -or
    @($request.containerDefinitions).Count -ne 1 -or
    @($request.containerDefinitions[0].command).Count -ne 1 -or
    ($request.containerDefinitions[0].command[0] -replace "`r`n", "`n").TrimEnd() -ne
      ($code -replace "`r`n", "`n").TrimEnd() -or
    @($request.containerDefinitions[0].environment).Count -ne 0 -or
    @($request.containerDefinitions[0].secrets).Count -ne 0) {
  throw 'FIXED_COMPARATOR_TASK_CONTRACT_MISMATCH'
}
aws ecs register-task-definition --cli-input-json "file://$path" --profile tracepoint-production --region us-east-1 --query 'taskDefinition.taskDefinitionArn' --output text
if ($LASTEXITCODE -ne 0) { throw 'TASK_REGISTRATION_FAILED' }
