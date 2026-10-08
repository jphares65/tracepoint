[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
    [ValidateSet('status','baseline','apply')][string]$Action = 'status',
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ImageCommit
)

# This command runs a finite ECS task. It never starts the web server, updates
# the ECS service, or reads a database secret on the operator workstation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$settings = @{
  staging = @{ Account='559054714699'; Profile='tracepoint-member-staging'; Role='TracePointMigrationStaging'; Region='us-east-1'; Cluster='tracepoint-staging'; Service='tracepoint-staging'; Repository='tracepoint-staging'; Bucket='tracepoint-staging-build-source-559054714699'; Key='source/tracepoint-staging-source.zip'; Build='tracepoint-staging-image-build'; MigrationSecret='arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/database/migrator-GqXXWG'; MigrationExecutionRole='arn:aws:iam::559054714699:role/tracepoint-staging-database-b-ExecutionRole605A040B-GlGTvUMuuERD'; MigrationTaskRole='arn:aws:iam::559054714699:role/tracepoint-staging-database-bootst-TaskRole30FC0FBB-ShizPcltAtFS' }
  production = @{ Account='193644343389'; Profile='tracepoint-production'; Role='TracePointMigrationProduction'; Region='us-east-1'; Cluster='tracepoint-production'; Service='tracepoint-production'; Repository='tracepoint-production'; Bucket='tracepoint-production-aws-native-build-source-193644343389'; Key='source/tracepoint-production-aws-native-source.zip'; Build='tracepoint-production-aws-native-image-build'; MigrationSecret='arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/migrator-8X57JT'; MigrationExecutionRole='arn:aws:iam::193644343389:role/tracepoint-production-databas-ExecutionRole605A040B-ifxXmYcgWwlh'; MigrationTaskRole='arn:aws:iam::193644343389:role/tracepoint-production-database-boo-TaskRole30FC0FBB-TGr1IQExOM1o' }
}[$Environment]
if ($Action -eq 'baseline' -and $Environment -ne 'staging') { throw 'Baseline is staging-only.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

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
  if (@(& git.exe -C $root status --porcelain --untracked-files=all).Count -ne 0) { throw 'Migration image must be built from a clean reviewed commit.' }
  return $sha
}
function Assert-Identity {
  $identity = Invoke-Aws @('sts','get-caller-identity')
  if ($identity.Account -ne $settings.Account -or $identity.Arn -notmatch "assumed-role/[^/]*$($settings.Role)[^/]*/") { throw 'AWS identity does not match the requested environment.' }
}
function Publish-MigrationImage([string]$Commit) {
  # The web image intentionally excludes the migration entry point.  Keep the
  # migration task's image immutable and tied to the same source commit, but
  # never reuse the application's SHA tag.
  $tag = if ($Environment -eq 'production') { "$Commit-aws-native-production" } else { $Commit }
  try { $existing = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1 } catch { $existing = $null }
  if ($existing -and $existing.imageDigest) { return @{ Tag=$tag; Digest=$existing.imageDigest } }
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-' + [guid]::NewGuid().ToString('N')); $zip = Join-Path $dir 'source.zip'
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    $paths = @('.dockerignore','lint-baseline.json','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','public','src','database/aws','database/rehearsal','supabase/migrations','scripts/assert-aws-native-provider-reachability.mjs','scripts/lint-ratchet.mjs','scripts/run-application-tests.mjs','scripts/aws-native-migrations.test.mjs','scripts/aws-native-migration-ledger-core.mjs','scripts/run-aws-native-migrations.mjs','scripts/validate-tracepoint-runtime-config.mjs','scripts/start-tracepoint-container.mjs','Dockerfile','buildspec.staging-image.yml')
    if ($Environment -eq 'production') { $paths = @('.dockerignore','lint-baseline.json','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','public','src','database/aws','database/rehearsal','supabase/migrations','scripts/assert-aws-native-provider-reachability.mjs','scripts/lint-ratchet.mjs','scripts/run-application-tests.mjs','scripts/aws-native-migrations.test.mjs','scripts/aws-native-migration-ledger-core.mjs','scripts/run-aws-native-migrations.mjs','scripts/validate-tracepoint-runtime-config.mjs','scripts/start-tracepoint-container.mjs','Dockerfile.aws-native-production','buildspec.production-image.yml') }
    & git.exe -C $root archive --format=zip "--output=$zip" $Commit -- @paths
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the immutable migration image source archive.' }
    $version = (Invoke-Aws @('s3api','put-object','--bucket',$settings.Bucket,'--key',$settings.Key,'--body',$zip,'--expected-bucket-owner',$settings.Account)).VersionId
    if (!$version -or $version -eq 'None') { throw 'Versioned source upload failed.' }
    $build = (Invoke-Aws @('codebuild','start-build','--project-name',$settings.Build,'--source-version',$version,'--environment-variables-override',"name=IMAGE_TAG,value=$tag,type=PLAINTEXT","name=SOURCE_COMMIT,value=$Commit,type=PLAINTEXT")).build
    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
    do { Start-Sleep -Seconds 15; $state = (Invoke-Aws @('codebuild','batch-get-builds','--ids',$build.id)).builds[0].buildStatus; if ($state -ne 'IN_PROGRESS') { break } } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ($state -ne 'SUCCEEDED') { throw "Migration image build ended with $state." }
  } finally { if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force } }
  $image = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1
  if (!$image.imageDigest) { throw 'Migration image was not published.' }
  return @{ Tag=$tag; Digest=$image.imageDigest }
}
function Invoke-MigrationTask([string]$Commit) {
  $service = (Invoke-Aws @('ecs','describe-services','--cluster',$settings.Cluster,'--services',$settings.Service)).services | Select-Object -First 1
  if (!$service -or $service.status -ne 'ACTIVE') { throw 'Expected ECS application service is not active.' }
  $current = (Invoke-Aws @('ecs','describe-task-definition','--task-definition',$service.taskDefinition)).taskDefinition
  if ($current.networkMode -ne 'awsvpc' -or @($current.requiresCompatibilities) -notcontains 'FARGATE' -or @($current.containerDefinitions).Count -ne 1) { throw 'Unexpected ECS task pattern.' }
  $image = Publish-MigrationImage $Commit
  $registration = [ordered]@{}
  foreach ($field in @('family','taskRoleArn','executionRoleArn','networkMode','containerDefinitions','volumes','placementConstraints','requiresCompatibilities','cpu','memory','runtimePlatform','ephemeralStorage')) {
    $property = $current.PSObject.Properties[$field]
    if ($null -ne $property -and $null -ne $property.Value) { $registration[$field] = $property.Value }
  }
  $registration.containerDefinitions[0].image = "$($settings.Account).dkr.ecr.$($settings.Region).amazonaws.com/$($settings.Repository)@$($image.Digest)"
  $registration.executionRoleArn = $settings.MigrationExecutionRole
  $registration.taskRoleArn = $settings.MigrationTaskRole
  $runtimeDatabaseSecret = @($registration.containerDefinitions[0].secrets | Where-Object name -eq 'TRACEPOINT_DATABASE_SECRET_JSON')
  if ($runtimeDatabaseSecret.Count -ne 1) { throw 'Expected exactly one runtime database secret in the application task definition.' }
  $requiredEnvironmentNames = @('TRACEPOINT_DATA_PROVIDER','TRACEPOINT_RUNTIME_PROVIDER_MODE','TRACEPOINT_DATABASE_CA_PATH')
  $requiredEnvironment = @($registration.containerDefinitions[0].environment | Where-Object name -in $requiredEnvironmentNames)
  if ($requiredEnvironment.Count -ne $requiredEnvironmentNames.Count) { throw 'Expected AWS-native migration runtime configuration is missing from the application task definition.' }
  $registration.containerDefinitions[0].environment = $requiredEnvironment + @(@{ name='CONFIGURATION_ENVIRONMENT'; value=$Environment })
  $registration.containerDefinitions[0].secrets = @(@{ name='TRACEPOINT_DATABASE_SECRET_JSON'; valueFrom=$settings.MigrationSecret })
  $payload = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-task-' + [guid]::NewGuid().ToString('N') + '.json')
  $overridesPayload = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-overrides-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText($payload, ($registration | ConvertTo-Json -Depth 100 -Compress), [Text.UTF8Encoding]::new($false))
    $definition = (Invoke-Aws @('ecs','register-task-definition','--cli-input-json',"file://$payload")).taskDefinition
    $overrides = @{ containerOverrides = @(@{ name='tracepoint'; command=@('scripts/run-aws-native-migrations.mjs',$Action,$Environment) }) }
    [IO.File]::WriteAllText($overridesPayload, ($overrides | ConvertTo-Json -Depth 10 -Compress), [Text.UTF8Encoding]::new($false))
    $awsvpc = $service.networkConfiguration.awsvpcConfiguration
    $network = "awsvpcConfiguration={subnets=[$($awsvpc.subnets -join ',')],securityGroups=[$($awsvpc.securityGroups -join ',')],assignPublicIp=$($awsvpc.assignPublicIp)}"
    $task = (Invoke-Aws @('ecs','run-task','--cluster',$settings.Cluster,'--task-definition',$definition.taskDefinitionArn,'--launch-type','FARGATE','--network-configuration',$network,'--overrides',"file://$overridesPayload")).tasks | Select-Object -First 1
    if (!$task.taskArn) { throw 'Migration task did not start.' }
    & aws.exe ecs wait tasks-stopped --cluster $settings.Cluster --tasks $task.taskArn --profile $settings.Profile --region $settings.Region
    if ($LASTEXITCODE -ne 0) { throw 'Migration task did not stop cleanly.' }
    $finished = (Invoke-Aws @('ecs','describe-tasks','--cluster',$settings.Cluster,'--tasks',$task.taskArn)).tasks | Select-Object -First 1
    $container = $finished.containers | Where-Object name -eq 'tracepoint' | Select-Object -First 1
    $stopCode = if ($null -ne $finished.PSObject.Properties['stopCode']) { $finished.stopCode } else { 'unavailable' }
    $stoppedReason = if ($null -ne $finished.PSObject.Properties['stoppedReason']) { $finished.stoppedReason } else { 'unavailable' }
    $exitCode = if ($null -ne $container -and $null -ne $container.PSObject.Properties['exitCode']) { $container.exitCode } else { $null }
    if ($stopCode -eq 'TaskFailedToStart') { throw "Migration task failed to start (stop code $stopCode, stopped reason $stoppedReason)." }
    if ($stopCode -ne 'EssentialContainerExited' -or $exitCode -ne 0) {
      $exitDetail = if ($null -eq $exitCode) { 'unavailable' } else { $exitCode }
      throw "Migration task failed (stop code $stopCode, stopped reason $stoppedReason, exit code $exitDetail)."
    }
    Write-Host "AWS-native migration task succeeded: $($task.taskArn); image $($image.Digest)."
  } finally {
    if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload -Force }
    if (Test-Path -LiteralPath $overridesPayload) { Remove-Item -LiteralPath $overridesPayload -Force }
  }
}

Assert-Identity
$commit = Require-CleanCommit
if ($ImageCommit) {
  $resolved = (& git.exe -C $root rev-parse "$ImageCommit^{commit}").Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $resolved -ne $ImageCommit) { throw 'Migration image commit is not a local immutable commit.' }
  $commit = $resolved
}
Invoke-MigrationTask $commit
