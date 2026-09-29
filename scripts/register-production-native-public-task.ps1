param([string] $Profile = 'tracepoint-production')
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$account = '193644343389'
$sourceArn = "arn:aws:ecs:$region`:$account`:task-definition/tracepoint-production-aws-native-no-traffic-proof:1"
$image = "$account.dkr.ecr.$region.amazonaws.com/tracepoint-production@sha256:cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46"
$identity = aws sts get-caller-identity --profile $Profile --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $account) { throw 'AWS_ACCOUNT_MISMATCH' }
$source = (aws ecs describe-task-definition --task-definition $sourceArn --profile $Profile --region $region --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or $source.containerDefinitions.Count -ne 1 -or
    $source.containerDefinitions[0].name -ne 'tracepoint' -or $source.containerDefinitions[0].image -ne $image -or
    $source.taskRoleArn -ne "arn:aws:iam::$account`:role/tracepoint-production-aws-native-proof-task-v1" -or
    $source.executionRoleArn -ne "arn:aws:iam::$account`:role/tracepoint-production-aws-native-proof-execution-v1" -or
    @($source.containerDefinitions[0].portMappings).Count -ne 0) { throw 'NATIVE_SOURCE_TASK_MISMATCH' }
$public = (aws ecs describe-services --cluster tracepoint-production --services tracepoint-production --profile $Profile --region $region --output json | ConvertFrom-Json).services[0]
if ($LASTEXITCODE -ne 0 -or $public.desiredCount -ne 0 -or $public.runningCount -ne 0 -or
    $public.taskDefinition -ne "arn:aws:ecs:$region`:$account`:task-definition/tracepoint-production-bridge-rollback-20260926:1" -or
    $public.loadBalancers.Count -ne 1 -or $public.loadBalancers[0].containerName -ne 'tracepoint' -or
    $public.loadBalancers[0].containerPort -ne 3000) { throw 'PUBLIC_SERVICE_BASELINE_MISMATCH' }
$container = $source.containerDefinitions[0]
$container.portMappings = @(@{ containerPort = 3000; hostPort = 3000; protocol = 'tcp' })
$definition = @{
  family = 'tracepoint-production-aws-native-public-20260928'
  taskRoleArn = $source.taskRoleArn
  executionRoleArn = $source.executionRoleArn
  networkMode = $source.networkMode
  requiresCompatibilities = @('FARGATE')
  cpu = [string]$source.cpu
  memory = [string]$source.memory
  volumes = @($source.volumes)
  containerDefinitions = @($container)
}
if ($null -ne $source.runtimePlatform) { $definition.runtimePlatform = $source.runtimePlatform }
$file = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-native-public-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($file, ($definition | ConvertTo-Json -Depth 40 -Compress), [Text.UTF8Encoding]::new($false))
  aws ecs register-task-definition --cli-input-json ('file://' + $file.Replace('\', '/')) --profile $Profile --region $region --query 'taskDefinition.{arn:taskDefinitionArn,image:containerDefinitions[0].image,ports:containerDefinitions[0].portMappings,role:taskRoleArn}' --output json
  if ($LASTEXITCODE -ne 0) { throw 'NATIVE_PUBLIC_TASK_REGISTRATION_FAILED' }
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
