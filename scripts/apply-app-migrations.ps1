[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
    [ValidateSet('status','inspect','publish-only','range-workspace-hotfix','baseline','reconcile','apply')][string]$Action = 'status',
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ImageCommit
)

# This command runs a finite ECS task. It never starts the web server, updates
# the ECS service, or reads a database secret on the operator workstation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$settings = @{
  staging = @{ Account='559054714699'; Profile='tracepoint-member-staging'; Role='TracePointMigrationStaging'; Region='us-east-1'; Cluster='tracepoint-staging'; Service='tracepoint-staging'; Repository='tracepoint-staging'; Bucket='tracepoint-staging-build-source-559054714699'; Key='source/tracepoint-staging-source.zip'; Build='tracepoint-staging-image-build'; MigrationTaskDefinition='tracepoint-staging-database-bootstrap:27'; MigratorSecretArn='arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/database/migrator-GqXXWG' }
  production = @{ Account='193644343389'; Profile='tracepoint-production'; Role='TracePointMigrationProduction'; Region='us-east-1'; Cluster='tracepoint-production'; Service='tracepoint-production'; Repository='tracepoint-production'; Bucket='tracepoint-production-aws-native-build-source-193644343389'; Key='source/tracepoint-production-aws-native-source.zip'; Build='tracepoint-production-aws-native-image-build'; MigrationTaskDefinition='tracepoint-production-database-bootstrap:3'; MigratorSecretArn='arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/migrator-8X57JT' }
}[$Environment]
if ($Action -eq 'baseline' -and $Environment -ne 'staging') { throw 'Baseline is staging-only.' }
if ($Action -eq 'publish-only' -and $Environment -ne 'production') { throw 'Publish-only is reserved for an explicitly reviewed production inspection image.' }
if ($Action -eq 'publish-only' -and -not $ImageCommit) { throw 'Publish-only requires an explicit immutable -ImageCommit.' }
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
function Get-OptionalPropertyValue($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}
function Get-ReportedValue($Value) {
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return 'not reported' }
  return [string]$Value
}
function Set-MigrationTaskContainerUser($Container) {
  # The bootstrap definition uses the Node builder user's name. The migration
  # image runs from its distroless nonroot stage, where that name is absent.
  # Keep least privilege while avoiding an image-local passwd-name lookup.
  $user = $Container.PSObject.Properties['user']
  if ($null -eq $user) { $Container | Add-Member -NotePropertyName user -NotePropertyValue '65532' }
  else { $user.Value = '65532' }
}
function Set-MigrationTaskContainerEntryPoint($Container) {
  # Bootstrap images may expose Node through PATH. The distroless migration
  # image does not, but it provides this absolute executable for its health
  # check and runtime. Never carry a bootstrap image entry point forward.
  $entryPoint = $Container.PSObject.Properties['entryPoint']
  if ($null -eq $entryPoint) { $Container | Add-Member -NotePropertyName entryPoint -NotePropertyValue @('/nodejs/bin/node') }
  else { $entryPoint.Value = @('/nodejs/bin/node') }
}
function Get-MigrationTaskFailureDetails($Task, [string]$ContainerName) {
  $container = @((Get-OptionalPropertyValue $Task 'containers') | Where-Object { (Get-OptionalPropertyValue $_ 'name') -eq $ContainerName }) | Select-Object -First 1
  $exitCode = Get-OptionalPropertyValue $container 'exitCode'
  [pscustomobject]@{
    StopCode = Get-ReportedValue (Get-OptionalPropertyValue $Task 'stopCode')
    StoppedReason = Get-ReportedValue (Get-OptionalPropertyValue $Task 'stoppedReason')
    ContainerReason = Get-ReportedValue (Get-OptionalPropertyValue $container 'reason')
    ExitCode = Get-ReportedValue $exitCode
    ExitCodeReported = $null -ne $exitCode
  }
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
function Test-EcrImageNotFoundError {
  param([Parameter(Mandatory)][System.Management.Automation.ErrorRecord]$ErrorRecord)
  return ([string]$ErrorRecord.Exception.Message -match '(?i)\(ImageNotFoundException\)\s+when calling the DescribeImages operation:')
}
function Wait-MigrationImageScan {
  param(
    [Parameter(Mandatory)][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$Digest,
    [ValidateRange(1,30)][int]$TimeoutMinutes = 15,
    [scriptblock]$Now = { [DateTimeOffset]::UtcNow },
    [scriptblock]$Sleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
  )
  $deadline = (& $Now).AddMinutes($TimeoutMinutes)
  do {
    $scan = Invoke-Aws @('ecr','describe-image-scan-findings','--repository-name',$settings.Repository,'--image-id',"imageDigest=$Digest")
    if ([string]$scan.imageId.imageDigest -ne $Digest) { throw 'Migration image scan returned a different digest than the image being verified.' }
    $status = [string]$scan.imageScanStatus.status
    if ($status -eq 'COMPLETE') {
      Assert-TracePointImageScan -Scan $scan
      return $Digest
    }
    if ($status -ne 'IN_PROGRESS') { throw "Migration image scan ended with $status." }
    if ((& $Now) -ge $deadline) { break }
    & $Sleep 10
  } while ((& $Now) -lt $deadline)
  throw "Migration image scan did not complete within $TimeoutMinutes minutes."
}
function Publish-MigrationImage {
  param(
    [Parameter(Mandatory)][string]$Commit,
    [scriptblock]$ScanNow = { [DateTimeOffset]::UtcNow },
    [scriptblock]$ScanSleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
  )
  # The web image intentionally excludes the migration entry point.  Keep the
  # migration task's image immutable and tied to the same source commit, but
  # never reuse the application's SHA tag.
  $tag = "migration-$Commit-aws-native-$Environment"
  try { $existing = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1 } catch {
    if (-not (Test-EcrImageNotFoundError -ErrorRecord $_)) { throw }
    $existing = $null
  }
  if ($existing -and $existing.imageDigest) {
    $digest = Wait-MigrationImageScan -Digest ([string]$existing.imageDigest) -Now $ScanNow -Sleep $ScanSleep
    return @{ Tag=$tag; Digest=$digest }
  }
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-' + [guid]::NewGuid().ToString('N')); $zip = Join-Path $dir 'source.zip'
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    # The Docker validation gates execute scripts directly and the production
    # lint ratchet checks every changed scripts/** file. Archive the complete
    # tree so the immutable build context cannot omit a referenced script.
    $paths = @('.dockerignore','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','public','src','database/aws','database/rehearsal','supabase/migrations','scripts','infra/lib/production-target.ts','Dockerfile','buildspec.staging-image.yml')
    if ($Environment -eq 'production') { $paths = @('.dockerignore','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','public','src','database/aws','database/rehearsal','supabase/migrations','scripts','infra/lib/production-target.ts','Dockerfile.aws-native-production','buildspec.production-image.yml') }
    & git.exe -C $root archive --format=zip "--output=$zip" $Commit -- @paths
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the immutable migration image source archive.' }
    $version = (Invoke-Aws @('s3api','put-object','--bucket',$settings.Bucket,'--key',$settings.Key,'--body',$zip,'--expected-bucket-owner',$settings.Account)).VersionId
    if (!$version -or $version -eq 'None') { throw 'Versioned source upload failed.' }
    $lintRatchetBaseline = '7ba11188dc8eb9fae119e131bd8053150b666ee7'
    & git.exe -C $root merge-base --is-ancestor $lintRatchetBaseline $Commit
    if ($LASTEXITCODE -ne 0) { throw "Production lint ratchet baseline $lintRatchetBaseline is not an ancestor of the reviewed commit." }

    $changedLintFiles = @(
      & git.exe -C $root diff --name-only "$lintRatchetBaseline..$Commit" -- |
        Where-Object { $_ -match '^(src|scripts)/.+\.[cm]?[jt]sx?$' }
    )
    if ($LASTEXITCODE -ne 0) { throw 'Unable to calculate the production lint ratchet changed-file manifest.' }

    $lintRatchetManifest = [Convert]::ToBase64String(
      [Text.Encoding]::UTF8.GetBytes(($changedLintFiles | ConvertTo-Json -Compress))
    )

    $build = (Invoke-Aws @(
      'codebuild','start-build',
      '--project-name',$settings.Build,
      '--source-version',$version,
      '--environment-variables-override',
      "name=IMAGE_TAG,value=$tag,type=PLAINTEXT",
      "name=SOURCE_COMMIT,value=$Commit,type=PLAINTEXT",
      "name=TRACEPOINT_LINT_RATCHET_CHANGED_FILES_B64,value=$lintRatchetManifest,type=PLAINTEXT",
      'name=TRACEPOINT_ARTIFACT_TYPE,value=migration,type=PLAINTEXT'
    )).build
    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
    do { Start-Sleep -Seconds 15; $state = (Invoke-Aws @('codebuild','batch-get-builds','--ids',$build.id)).builds[0].buildStatus; if ($state -ne 'IN_PROGRESS') { break } } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ($state -ne 'SUCCEEDED') { throw "Migration image build ended with $state." }
  } finally { if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force } }
  $image = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1
  if ([string]$image.imageDigest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'Migration image was not published with a valid immutable digest.' }
  $digest = Wait-MigrationImageScan -Digest ([string]$image.imageDigest) -Now $ScanNow -Sleep $ScanSleep
  return @{ Tag=$tag; Digest=$digest }
}
function Invoke-MigrationTask {
  param(
    [Parameter(Mandatory)][string]$Commit,
    [scriptblock]$ScanNow = { [DateTimeOffset]::UtcNow },
    [scriptblock]$ScanSleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
  )
  $service = (Invoke-Aws @('ecs','describe-services','--cluster',$settings.Cluster,'--services',$settings.Service)).services | Select-Object -First 1
  if (!$service -or $service.status -ne 'ACTIVE') { throw 'Expected ECS application service is not active.' }
  $sourceTaskDefinition = if ($settings.MigrationTaskDefinition) { $settings.MigrationTaskDefinition } else { $service.taskDefinition }
  $current = (Invoke-Aws @('ecs','describe-task-definition','--task-definition',$sourceTaskDefinition)).taskDefinition
  if ($current.networkMode -ne 'awsvpc' -or @($current.requiresCompatibilities) -notcontains 'FARGATE' -or @($current.containerDefinitions).Count -ne 1) { throw 'Unexpected ECS task pattern.' }
  $image = Publish-MigrationImage -Commit $Commit -ScanNow $ScanNow -ScanSleep $ScanSleep
  $registration = [ordered]@{}
  foreach ($field in @('family','taskRoleArn','executionRoleArn','networkMode','containerDefinitions','volumes','placementConstraints','requiresCompatibilities','cpu','memory','runtimePlatform','ephemeralStorage')) {
    $property = $current.PSObject.Properties[$field]
    if ($null -ne $property -and $null -ne $property.Value) { $registration[$field] = $property.Value }
  }
  $container = $registration.containerDefinitions[0]
  $container.image = "$($settings.Account).dkr.ecr.$($settings.Region).amazonaws.com/$($settings.Repository)@$($image.Digest)"
  $container.command = @('scripts/run-aws-native-migrations.mjs',$Action,$Environment)
  Set-MigrationTaskContainerUser $container
  Set-MigrationTaskContainerEntryPoint $container
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
      [ordered]@{ name='DEPLOYMENT_VERSION'; value=$Commit }
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
    $failure = Get-MigrationTaskFailureDetails $finished $container.name
    if ($failure.StopCode -ne 'EssentialContainerExited' -or -not $failure.ExitCodeReported -or $failure.ExitCode -ne '0') {
      throw "Migration task failed (stop code $($failure.StopCode); stopped reason $($failure.StoppedReason); container reason $($failure.ContainerReason); exit code $($failure.ExitCode))."
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
  if ($Action -eq 'publish-only' -and $resolved -ne $commit) { throw 'Publish-only requires -ImageCommit to match the clean reviewed HEAD.' }
  $commit = $resolved
}
if ($Action -eq 'publish-only') {
  $published = Publish-MigrationImage $commit
  Write-Output (ConvertTo-Json $published -Compress)
} else {
  Invoke-MigrationTask $commit
}
