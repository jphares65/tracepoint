[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
    [ValidateSet('status','baseline','reconcile','apply','diagnose')][string]$Action = 'status',
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ImageCommit,
    [ValidatePattern('^[0-9a-f]{40}$')][string]$MigrationSourceCommit,
    [ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ApplicationImageDigest
)

# This command runs a finite ECS task. It never starts the web server, updates
# the ECS service, or reads a database secret on the operator workstation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'migration-release-core.psm1') -Force

$settings = @{
  staging = @{ Account='559054714699'; Profile='tracepoint-member-staging'; Role='TracePointMigrationStaging'; Region='us-east-1'; Cluster='tracepoint-staging'; Service='tracepoint-staging'; Repository='tracepoint-staging'; Bucket='tracepoint-staging-build-source-559054714699'; Key='source/tracepoint-staging-source.zip'; Build='tracepoint-staging-image-build'; MigrationTaskDefinition='tracepoint-staging-database-bootstrap:27'; MigratorSecretArn='arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/database/migrator-GqXXWG' }
  production = @{ Account='193644343389'; Profile='tracepoint-production'; Role='TracePointMigrationProduction'; Region='us-east-1'; Cluster='tracepoint-production'; Service='tracepoint-production'; Repository='tracepoint-production'; Bucket='tracepoint-production-aws-native-build-source-193644343389'; Key='source/tracepoint-production-aws-native-source.zip'; Build='tracepoint-production-aws-native-image-build' }
}[$Environment]
if ($Action -eq 'baseline' -and $Environment -ne 'staging') { throw 'Baseline is staging-only.' }
if ($Action -eq 'diagnose' -and $Environment -ne 'staging') { throw 'Database diagnostics are staging-only.' }
if ($Action -eq 'diagnose' -and $ImageCommit -cne 'a3fa9855f4c797dfb7b4dd16144cf6c85a445946') { throw 'Migration 038 diagnostics require the already-built application commit a3fa9855f4c797dfb7b4dd16144cf6c85a445946.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$migrationFiles = @(Get-AwsMigrationFiles -Directory (Join-Path $root 'database/aws'))

function Invoke-Aws([string[]]$Arguments) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & aws.exe @Arguments --profile $settings.Profile --region $settings.Region --output json 2>&1
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($exitCode -ne 0) { throw "AWS command failed: aws $($Arguments -join ' ') :: $($output -join ' ')" }
  return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}
function Require-CleanCommit {
  $sha = (& git.exe -C $root rev-parse HEAD).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') { throw 'Unable to resolve HEAD.' }
  $status = @(& git.exe -C $root status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the migration image working tree.' }
  if ($status.Count -ne 0) { throw 'Migration image must be built from a clean reviewed commit.' }
  return $sha
}
function Assert-Identity {
  $identity = Invoke-Aws @('sts','get-caller-identity')
  if ($Environment -eq 'staging') { Assert-StagingIdentity -Identity $identity | Out-Null; return }
  if ($identity.Account -ne $settings.Account -or $identity.Arn -notmatch "assumed-role/[^/]*$($settings.Role)[^/]*/") { throw 'AWS identity does not match the requested environment.' }
}
function Assert-ReviewedApplicationImage([string]$Commit,[string]$ExpectedDigest) {
  $tag = Get-ReviewedImageTag -Environment $Environment -Commit $Commit
  $image = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1
  if (!$image -or @($image.imageTags) -cnotcontains $tag) { throw "Reviewed application image '$tag' is absent or unverified." }
  Assert-ImageDigest -Actual $image.imageDigest -Expected $ExpectedDigest | Out-Null
  Assert-CleanImageScan -Digest $ExpectedDigest
  return $image.imageDigest
}
function Assert-CleanImageScan([string]$Digest) {
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(15)
  do {
    $scan = Invoke-Aws @('ecr','describe-image-scan-findings','--repository-name',$settings.Repository,'--image-id',"imageDigest=$Digest")
    $state = [string]$scan.imageScanStatus.status
    if ($state -eq 'COMPLETE') {
      $findings = $scan.imageScanFindings.findingSeverityCounts
      if ($null -ne $findings -and @($findings.PSObject.Properties | Where-Object { [int]$_.Value -ne 0 }).Count -gt 0) { throw 'Migration image scan has findings; release stopped.' }
      return
    }
    if ($state -ne 'IN_PROGRESS') { throw "Migration image scan ended with '$state'." }
    Start-Sleep -Seconds 10
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw 'Migration image scan did not complete within 15 minutes.'
}
function Publish-MigrationImage([string]$MigrationCommit) {
  # The web image intentionally excludes the migration entry point.  Keep the
  # migration task's image immutable and tied to the same source commit, but
  # never reuse the application's SHA tag.
  $tag = "migration-$MigrationCommit-aws-native-$Environment"
  $existing = $null
  try { $existing = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1 }
  catch { if ($_.Exception.Message -notmatch 'ImageNotFoundException|ImageNotFound') { throw } }
  if ($existing -and $existing.imageDigest) {
    if (@($existing.imageTags) -cnotcontains $tag) { throw 'Existing migration image tag is not attested by ECR.' }
    Assert-CleanImageScan -Digest $existing.imageDigest
    return @{ Tag=$tag; Digest=$existing.imageDigest }
  }
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-' + [guid]::NewGuid().ToString('N')); $zip = Join-Path $dir 'source.zip'
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    $paths = @('.dockerignore','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','public','src','database/aws','database/rehearsal','supabase/migrations','scripts/assert-aws-native-provider-reachability.mjs','scripts/run-aws-native-migrations.mjs','scripts/aws-native-migration-diagnostics.mjs','scripts/validate-tracepoint-runtime-config.mjs','scripts/start-tracepoint-container.mjs','scripts/run-application-tests.mjs','Dockerfile','buildspec.staging-image.yml')
    if ($Environment -eq 'staging') { $paths += @('scripts/mobile-route-image-contract-core.mjs','scripts/test-staging-image-mobile-routes.sh') }
    if ($Environment -eq 'production') { $paths = @('.dockerignore','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','public','src','database/aws','database/rehearsal','supabase/migrations','scripts/assert-aws-native-provider-reachability.mjs','scripts/run-aws-native-migrations.mjs','scripts/aws-native-migration-diagnostics.mjs','scripts/validate-tracepoint-runtime-config.mjs','scripts/start-tracepoint-container.mjs','scripts/run-application-tests.mjs','Dockerfile.aws-native-production','buildspec.production-image.yml') }
    & git.exe -C $root -c core.autocrlf=true archive --format=zip "--output=$zip" $MigrationCommit -- @paths
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the immutable migration image source archive.' }
    $version = (Invoke-Aws @('s3api','put-object','--bucket',$settings.Bucket,'--key',$settings.Key,'--body',$zip,'--expected-bucket-owner',$settings.Account)).VersionId
    if (!$version -or $version -eq 'None') { throw 'Versioned source upload failed.' }
    $build = (Invoke-Aws @('codebuild','start-build','--project-name',$settings.Build,'--source-version',$version,'--environment-variables-override',"name=IMAGE_TAG,value=$tag,type=PLAINTEXT","name=SOURCE_COMMIT,value=$MigrationCommit,type=PLAINTEXT",'name=TRACEPOINT_ARTIFACT_TYPE,value=migration,type=PLAINTEXT')).build
    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
    do { Start-Sleep -Seconds 15; $state = (Invoke-Aws @('codebuild','batch-get-builds','--ids',$build.id)).builds[0].buildStatus; if ($state -ne 'IN_PROGRESS') { break } } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ($state -ne 'SUCCEEDED') { throw "Migration image build ended with $state." }
  } finally { if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force } }
  $image = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1
  if (!$image.imageDigest -or @($image.imageTags) -cnotcontains $tag) { throw 'Migration image was not published under its exact immutable commit tag.' }
  Assert-CleanImageScan -Digest $image.imageDigest
  return @{ Tag=$tag; Digest=$image.imageDigest }
}
function Read-MigrationTaskReport([string]$LogGroup,[string]$StreamName) {
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes(2)
  do {
    $messages = [System.Collections.Generic.List[string]]::new()
    $token = $null
    for ($pageNumber = 0; $pageNumber -lt 20; $pageNumber++) {
      $arguments = @('logs','get-log-events','--log-group-name',$LogGroup,'--log-stream-name',$StreamName,'--start-from-head')
      if ($token) { $arguments += @('--next-token',$token) }
      try { $page = Invoke-Aws $arguments }
      catch {
        if ($_.Exception.Message -match 'ResourceNotFoundException|ResourceNotFound') { break }
        throw
      }
      foreach ($event in @($page.events)) { $messages.Add([string]$event.message) }
      $nextToken = [string]$page.nextForwardToken
      if ([string]::IsNullOrWhiteSpace($nextToken) -or $nextToken -eq $token) { break }
      $token = $nextToken
    }
    if ($messages.Count -gt 0) {
      try { return ConvertFrom-MigrationRunnerLog -Messages @($messages.ToArray()) }
      catch {
        if ($_.Exception.Message -notmatch 'Migration task logs are missing|Expected one migration ledger JSON report') { throw }
      }
    }
    Start-Sleep -Seconds 3
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  throw 'Migration task logs did not contain a parseable ledger report.'
}
function Invoke-MigrationTask([string]$ApplicationCommit,[string]$ApplicationDigest,[string]$TaskAction,[string]$MigrationDigest) {
  Assert-ReviewedApplicationImage -Commit $ApplicationCommit -ExpectedDigest $ApplicationDigest | Out-Null
  $service = (Invoke-Aws @('ecs','describe-services','--cluster',$settings.Cluster,'--services',$settings.Service)).services | Select-Object -First 1
  if (!$service -or $service.status -ne 'ACTIVE') { throw 'Expected ECS application service is not active.' }
  $sourceTaskDefinition = if ($settings.MigrationTaskDefinition) { $settings.MigrationTaskDefinition } else { $service.taskDefinition }
  $current = (Invoke-Aws @('ecs','describe-task-definition','--task-definition',$sourceTaskDefinition)).taskDefinition
  if ($current.networkMode -ne 'awsvpc' -or @($current.requiresCompatibilities) -notcontains 'FARGATE' -or @($current.containerDefinitions).Count -ne 1) { throw 'Unexpected ECS task pattern.' }
  $image = if ($MigrationDigest) { @{ Tag="migration-$MigrationSourceCommit-aws-native-$Environment"; Digest=$MigrationDigest } } else { Publish-MigrationImage $MigrationSourceCommit }
  Assert-ImageDigest -Actual $image.Digest -Expected $image.Digest | Out-Null
  $registration = [ordered]@{}
  foreach ($field in @('family','taskRoleArn','executionRoleArn','networkMode','containerDefinitions','volumes','placementConstraints','requiresCompatibilities','cpu','memory','runtimePlatform','ephemeralStorage')) {
    $property = $current.PSObject.Properties[$field]
    if ($null -ne $property -and $null -ne $property.Value) { $registration[$field] = $property.Value }
  }
  $container = $registration.containerDefinitions[0]
  $container.image = "$($settings.Account).dkr.ecr.$($settings.Region).amazonaws.com/$($settings.Repository)@$($image.Digest)"
  $container.command = @('scripts/run-aws-native-migrations.mjs',$TaskAction,$Environment)
  if ($container.logConfiguration.logDriver -cne 'awslogs') { throw 'Migration task must use CloudWatch awslogs to return its ledger report.' }
  $logOptions = $container.logConfiguration.options
  $logGroup = [string]$logOptions.'awslogs-group'
  $logPrefix = [string]$logOptions.'awslogs-stream-prefix'
  if ([string]::IsNullOrWhiteSpace($logGroup) -or [string]::IsNullOrWhiteSpace($logPrefix) -or [string]$logOptions.'awslogs-region' -cne $settings.Region) { throw 'Migration task CloudWatch log configuration is missing or points to the wrong region.' }
  if ($settings.MigratorSecretArn) {
    # A migration task must use the existing database-owner credential, never
    # the web service's least-privileged runtime credential.  Deliberately
    # replace the bootstrap task's names with the runner's single input.
    $container.secrets = @([ordered]@{ name='TRACEPOINT_DATABASE_SECRET_JSON'; valueFrom=$settings.MigratorSecretArn })
    $container.environment = @(
      [ordered]@{ name='CONFIGURATION_ENVIRONMENT'; value=$Environment },
      [ordered]@{ name='TRACEPOINT_DATA_PROVIDER'; value='postgres' },
      [ordered]@{ name='TRACEPOINT_RUNTIME_PROVIDER_MODE'; value='aws-native' },
      [ordered]@{ name='TRACEPOINT_DATABASE_CA_PATH'; value='/app/rds-ca.pem' },
      [ordered]@{ name='DEPLOYMENT_VERSION'; value=$ApplicationCommit }
    )
  }
  $payload = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-task-' + [guid]::NewGuid().ToString('N') + '.json')
  $overridesPayload = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-overrides-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText($payload, ($registration | ConvertTo-Json -Depth 100 -Compress), [Text.UTF8Encoding]::new($false))
    $definition = (Invoke-Aws @('ecs','register-task-definition','--cli-input-json',"file://$payload")).taskDefinition
    $overrides = @{ containerOverrides = @(@{ name=$container.name; command=$container.command }) } | ConvertTo-Json -Depth 10 -Compress
    [IO.File]::WriteAllText($overridesPayload, $overrides, [Text.UTF8Encoding]::new($false))
    $awsvpc = $service.networkConfiguration.awsvpcConfiguration
    $network = "awsvpcConfiguration={subnets=[$($awsvpc.subnets -join ',')],securityGroups=[$($awsvpc.securityGroups -join ',')],assignPublicIp=$($awsvpc.assignPublicIp)}"
    $task = (Invoke-Aws @('ecs','run-task','--cluster',$settings.Cluster,'--task-definition',$definition.taskDefinitionArn,'--launch-type','FARGATE','--network-configuration',$network,'--overrides',"file://$overridesPayload")).tasks | Select-Object -First 1
    if (!$task.taskArn) { throw 'Migration task did not start.' }
    & aws.exe ecs wait tasks-stopped --cluster $settings.Cluster --tasks $task.taskArn --profile $settings.Profile --region $settings.Region
    if ($LASTEXITCODE -ne 0) { throw 'Migration task did not stop cleanly.' }
    $finished = (Invoke-Aws @('ecs','describe-tasks','--cluster',$settings.Cluster,'--tasks',$task.taskArn)).tasks | Select-Object -First 1
    $finishedContainer = $finished.containers | Where-Object name -eq $container.name | Select-Object -First 1
    if ($finished.stopCode -ne 'EssentialContainerExited' -or $finishedContainer.exitCode -ne 0) { throw "Migration task failed (stop code $($finished.stopCode), exit code $($finishedContainer.exitCode))." }
    $taskId = [string]$task.taskArn.Split('/')[-1]
    $streamName = "$logPrefix/$($container.name)/$taskId"
    $report = Read-MigrationTaskReport -LogGroup $logGroup -StreamName $streamName
    if ($TaskAction -ne 'diagnose') {
      $expectation = if ($TaskAction -eq 'apply') { 'after-apply' } else { 'status' }
      Assert-MigrationLedgerReport -Report $report -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation $expectation | Out-Null
    }
    Write-Host "AWS-native migration task succeeded: $($task.taskArn); image $($image.Digest)."
    return $report
  } finally {
    if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload -Force }
    if (Test-Path -LiteralPath $overridesPayload) { Remove-Item -LiteralPath $overridesPayload -Force }
  }
}

$archiveTest = Join-Path $PSScriptRoot 'aws-native-migration-archive.test.mjs'
$archiveTestOutput = @(& node.exe --test $archiveTest 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Migration source archive validation failed: $($archiveTestOutput -join ' ')" }
$archiveTestOutput | ForEach-Object { Write-Host $_ }

Assert-Identity
$commit = Require-CleanCommit
$toolingCommit = $commit
if ($MigrationSourceCommit) {
  $resolvedToolingCommit = (& git.exe -C $root rev-parse "$MigrationSourceCommit^{commit}").Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $resolvedToolingCommit -cne $MigrationSourceCommit -or $resolvedToolingCommit -cne $toolingCommit) { throw 'Migration image must use the exact reviewed release-tooling commit.' }
}
$applicationCommit = if ($ImageCommit) { $ImageCommit } else { $toolingCommit }
$resolvedApplicationCommit = (& git.exe -C $root rev-parse "$applicationCommit^{commit}").Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $resolvedApplicationCommit -cne $applicationCommit) { throw 'Application image must use an exact local reviewed commit.' }
& git.exe -C $root merge-base --is-ancestor $applicationCommit $toolingCommit
if ($LASTEXITCODE -ne 0) { throw 'Application commit must be contained in the reviewed release-tooling commit.' }
if (-not $ApplicationImageDigest) { throw 'A verified application image digest is required for migration tasks.' }
$applicationDigest = Assert-ReviewedApplicationImage -Commit $applicationCommit -ExpectedDigest $ApplicationImageDigest
$migrationImage = Publish-MigrationImage $toolingCommit
if ($Action -eq 'apply') {
  $before = Invoke-MigrationTask -ApplicationCommit $applicationCommit -ApplicationDigest $applicationDigest -TaskAction 'status' -MigrationDigest $migrationImage.Digest
  Assert-MigrationLedgerReport -Report $before -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation 'before-apply' | Out-Null
  $result = Invoke-MigrationTask -ApplicationCommit $applicationCommit -ApplicationDigest $applicationDigest -TaskAction 'apply' -MigrationDigest $migrationImage.Digest
  Assert-MigrationLedgerReport -Report $result -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation 'after-apply' | Out-Null
  Assert-EntitlementMigrationRecord -Report $result -ApplicationCommit $applicationCommit -Environment $Environment | Out-Null
  $after = Invoke-MigrationTask -ApplicationCommit $applicationCommit -ApplicationDigest $applicationDigest -TaskAction 'status' -MigrationDigest $migrationImage.Digest
  Assert-MigrationLedgerReport -Report $after -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation 'after-apply' | Out-Null
  Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit $applicationCommit -Environment $Environment | Out-Null
  return $after
}
$result = Invoke-MigrationTask -ApplicationCommit $applicationCommit -ApplicationDigest $applicationDigest -TaskAction $Action -MigrationDigest $migrationImage.Digest
return $result
