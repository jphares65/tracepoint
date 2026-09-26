$ErrorActionPreference = 'Stop'

$account = '193644343389'
$region = 'us-east-1'
$profile = 'tracepoint-production'
$hostName = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com'
$resourceId = 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE'
$secretArn = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/final/database-runtime-20260926-yg23sb'
$keyArn = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55'
$executionRole = 'TracePoint-RestRdsImportExec-4272874f'
$policyName = 'TracePointFinalRuntimeCredentialProbeTemporary20260926'
$baseFamily = 'tracepoint-production-final-target-schema-prep-20260926:1'
$probeFamily = 'tracepoint-production-final-target-runtime-credential-probe-20260926'
$expectedImage = '193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@sha256:7617c1c543e5ff17b1215fb9882f22b557ce4becb2a9acbd874c4012420260de'
$temporaryFiles = [System.Collections.Generic.List[string]]::new()
$policyInstalled = $false

function Invoke-AwsJson([string[]]$Arguments) {
  $result = & aws @Arguments --profile $profile --region $region --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS_COMMAND_FAILED: $($Arguments[0]) $($Arguments[1])" }
  return ($result | ConvertFrom-Json)
}

function New-RequestFile($Value, [string]$Prefix) {
  $path = Join-Path ([IO.Path]::GetTempPath()) ($Prefix + [guid]::NewGuid().ToString('N') + '.json')
  [IO.File]::WriteAllText($path, ($Value | ConvertTo-Json -Depth 60 -Compress), [Text.UTF8Encoding]::new($false))
  $temporaryFiles.Add($path)
  return ('file://' + $path.Replace('\', '/'))
}

try {
  $identity = Invoke-AwsJson -Arguments @('sts','get-caller-identity')
  if ($identity.Account -ne $account) { throw 'ACCOUNT_ATTESTATION_FAILED' }
  $target = (Invoke-AwsJson -Arguments @('rds','describe-db-instances','--db-instance-identifier','tracepoint-production-final-cutover-20260926')).DBInstances[0]
  if ($target.DbiResourceId -ne $resourceId -or $target.Endpoint.Address -ne $hostName -or
      $target.DBName -ne 'tracepoint' -or $target.PubliclyAccessible -or
      -not $target.StorageEncrypted -or -not $target.DeletionProtection -or
      $target.DBInstanceStatus -ne 'available') { throw 'FINAL_RDS_ATTESTATION_FAILED' }
  $secret = Invoke-AwsJson -Arguments @('secretsmanager','describe-secret','--secret-id',$secretArn)
  if ($secret.ARN -ne $secretArn -or $secret.KmsKeyId -ne $keyArn -or $secret.DeletedDate) { throw 'FINAL_SECRET_ATTESTATION_FAILED' }
  $base = (Invoke-AwsJson -Arguments @('ecs','describe-task-definition','--task-definition',$baseFamily)).taskDefinition
  if ($base.containerDefinitions.Count -ne 1 -or $base.containerDefinitions[0].image -ne $expectedImage -or
      $base.containerDefinitions[0].user -ne '65532' -or
      $base.executionRoleArn -ne "arn:aws:iam::${account}:role/${executionRole}") { throw 'BASE_TASK_ATTESTATION_FAILED' }
  $existingPolicies = Invoke-AwsJson -Arguments @('iam','list-role-policies','--role-name',$executionRole)
  if ($existingPolicies.PolicyNames -contains $policyName) { throw 'TEMPORARY_POLICY_ALREADY_PRESENT' }

  $policy = @{
    Version = '2012-10-17'
    Statement = @(
      @{ Effect = 'Allow'; Action = @('secretsmanager:GetSecretValue'); Resource = $secretArn },
      @{ Effect = 'Allow'; Action = @('kms:Decrypt'); Resource = $keyArn
         Condition = @{ StringEquals = @{ 'kms:ViaService' = "secretsmanager.${region}.amazonaws.com" } } }
    )
  }
  $policyFile = New-RequestFile $policy 'tracepoint-final-runtime-probe-policy-'
  & aws iam put-role-policy --role-name $executionRole --policy-name $policyName --policy-document $policyFile --profile $profile --region $region
  if ($LASTEXITCODE -ne 0) { throw 'TEMPORARY_POLICY_INSTALL_FAILED' }
  $policyInstalled = $true

  $container = $base.containerDefinitions[0]
  $container.entryPoint = @('/nodejs/bin/node')
  $container.command = @('-e', (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'final-target-runtime-credential-readonly.cjs') -Raw))
  $container.secrets = @(@{ name = 'TARGET_DATABASE_SECRET_JSON'; valueFrom = $secretArn })
  $container.environment = @()
  $request = @{
    family = $probeFamily
    executionRoleArn = $base.executionRoleArn
    networkMode = $base.networkMode
    containerDefinitions = @($container)
    requiresCompatibilities = $base.requiresCompatibilities
    cpu = $base.cpu
    memory = $base.memory
  }
  if ($base.runtimePlatform) { $request.runtimePlatform = $base.runtimePlatform }
  $taskFile = New-RequestFile $request 'tracepoint-final-runtime-probe-task-'
  $definition = Invoke-AwsJson -Arguments @('ecs','register-task-definition','--cli-input-json',$taskFile)
  if ($definition.taskDefinition.family -ne $probeFamily) { throw 'PROBE_TASK_REGISTRATION_FAILED' }

  $network = 'awsvpcConfiguration={subnets=[subnet-0f4cbed3e60d90bfc,subnet-0a117bec5cb98607f],securityGroups=[sg-061d23d7deb66e307],assignPublicIp=ENABLED}'
  $launch = Invoke-AwsJson -Arguments @('ecs','run-task','--cluster','tracepoint-production','--task-definition',$definition.taskDefinition.taskDefinitionArn,
    '--launch-type','FARGATE','--count','1','--network-configuration',$network)
  if ($launch.failures.Count -ne 0 -or $launch.tasks.Count -ne 1) { throw 'PROBE_LAUNCH_FAILED' }
  $taskArn = $launch.tasks[0].taskArn
  & aws ecs wait tasks-stopped --cluster tracepoint-production --tasks $taskArn --profile $profile --region $region
  if ($LASTEXITCODE -ne 0) { throw 'PROBE_WAIT_FAILED' }
  $finished = (Invoke-AwsJson -Arguments @('ecs','describe-tasks','--cluster','tracepoint-production','--tasks',$taskArn)).tasks[0]
  $exitCode = $finished.containers[0].exitCode
  Write-Output ("FINAL_TARGET_PROBE_TASK={0};EXIT={1};STOP={2}" -f $taskArn,$exitCode,$finished.stoppedReason)
  if ($exitCode -ne 0) { throw 'FINAL_RUNTIME_CREDENTIAL_PROBE_FAILED' }
} finally {
  if ($policyInstalled) {
    & aws iam delete-role-policy --role-name $executionRole --policy-name $policyName --profile $profile --region $region
    if ($LASTEXITCODE -ne 0) { Write-Error 'TEMPORARY_POLICY_REMOVAL_FAILED' }
  }
  foreach ($path in $temporaryFiles) { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
}
