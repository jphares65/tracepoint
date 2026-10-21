[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('staging','production')][string]$Environment,
    # Staging release lane: status, baseline, reconcile, apply, diagnose.
    # Production lane: inspect, publish-only, range-workspace-hotfix and the guarded live final-database actions.
    [ValidateSet('status','baseline','reconcile','apply','diagnose','inspect','publish-only','range-workspace-hotfix','precheck','inventory-035-037','password-scope-039-040','agency-documents-038-047')][string]$Action = 'status',
    [ValidatePattern('^[0-9a-f]{40}$')][string]$ImageCommit,
    [ValidatePattern('^[0-9a-f]{40}$')][string]$MigrationSourceCommit,
    [ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ApplicationImageDigest,
    [switch]$AuthorizeLiveDatabaseChange,
    [string]$PasswordScopeResolutionsPath
)

# This command runs a finite ECS task. It never starts the web server, updates
# the ECS service, or reads a database secret on the operator workstation.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'migration-release-core.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$settings = @{
  staging = @{ Account='559054714699'; Profile='tracepoint-member-staging'; Role='TracePointMigrationStaging'; Region='us-east-1'; Cluster='tracepoint-staging'; Service='tracepoint-staging'; Repository='tracepoint-staging'; Bucket='tracepoint-staging-build-source-559054714699'; Key='source/tracepoint-staging-source.zip'; Build='tracepoint-staging-image-build'; MigrationTaskDefinition='tracepoint-staging-database-bootstrap:27'; MigratorSecretArn='arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/database/migrator-GqXXWG' }
  production = @{ Account='193644343389'; Profile='tracepoint-production'; Role='TracePointMigrationProduction'; Region='us-east-1'; Cluster='tracepoint-production'; Service='tracepoint-production'; Repository='tracepoint-production'; Bucket='tracepoint-production-aws-native-build-source-193644343389'; Key='source/tracepoint-production-aws-native-source.zip'; Build='tracepoint-production-aws-native-image-build'; MigrationTaskDefinition='tracepoint-production-database-bootstrap:3'; MigratorSecretArn='arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/migrator-8X57JT'; LiveDatabaseInstance='tracepoint-production-final-cutover-20260926'; LiveDatabaseHost='tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com'; LiveDatabaseSecretArn='arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/final/database-runtime-20260926-yg23sb'; LiveDatabaseSecretVersionId='5edc21b8-99f0-183c-a6e8-98f0809d0594'; LiveInspectionFamily='tracepoint-production-live-database-inspect' }
}[$Environment]
if ($Action -eq 'baseline' -and $Environment -ne 'staging') { throw 'Baseline is staging-only.' }
if ($Action -eq 'diagnose' -and $Environment -ne 'staging') { throw 'Database diagnostics are staging-only.' }
if ($Action -eq 'diagnose' -and $ImageCommit -cne 'a3fa9855f4c797dfb7b4dd16144cf6c85a445946') { throw 'Migration 038 diagnostics require the already-built application commit a3fa9855f4c797dfb7b4dd16144cf6c85a445946.' }
# The migration-first release lane (migrate-db.ps1, release-entitlements-staging.ps1)
# verifies a reviewed application image digest, runs a migration image built from
# the release-tooling commit, and checks the ledger report read from CloudWatch.
# Every staging status/baseline/reconcile/apply/diagnose run takes this lane; a
# production run takes it only when a caller supplies the release-lane inputs
# (migrate-db.ps1 does for production status).
$releaseLaneActions = @('status','baseline','reconcile','apply','diagnose')
$releaseLane = $Action -in $releaseLaneActions -and ($Environment -eq 'staging' -or $ApplicationImageDigest -or $MigrationSourceCommit)
if ($releaseLane -and -not $ApplicationImageDigest) { throw 'A verified application image digest is required for migration tasks.' }
if (-not $releaseLane -and ($ApplicationImageDigest -or $MigrationSourceCommit)) { throw "-ApplicationImageDigest and -MigrationSourceCommit apply only to the migration release lane ($($releaseLaneActions -join ', '))." }
if ($Action -eq 'publish-only' -and $Environment -ne 'production') { throw 'Publish-only is reserved for an explicitly reviewed production inspection image.' }
if ($Action -eq 'publish-only' -and -not $ImageCommit) { throw 'Publish-only requires an explicit immutable -ImageCommit.' }
# Guarded actions on the live final-cutover database. They run the owner
# credential against the pinned live host; two of them change the database.
$liveOwnerActions = @('precheck','inventory-035-037','password-scope-039-040','agency-documents-038-047')
$liveDatabaseChangeActions = @('inventory-035-037','password-scope-039-040','agency-documents-038-047')
if ($Action -in $liveOwnerActions -and $Environment -ne 'production') { throw 'Live final-database actions are production-only.' }
# The reviewed list of password operations to resolve travels with the task;
# the runner validates it in full before connecting.
function Read-PasswordScopeResolutions([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'password-scope-039-040 requires -PasswordScopeResolutionsPath with the reviewed resolution list.' }
  $text = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).Path)
  if ($text -match '@') { throw 'The resolution list must not contain personal data.' }
  # Windows PowerShell emits a JSON array as one object; enumerate its entries.
  $entries = @(($text | ConvertFrom-Json) | ForEach-Object { $_ })
  if (@($entries | Where-Object { [string]$_.operation_id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }).Count -ne 0) { throw 'The resolution list contains an invalid operation id.' }
  return ConvertTo-Json -InputObject $entries -Depth 10 -Compress
}
$passwordScopeResolutionsJson = $null
if ($Action -eq 'password-scope-039-040') { $passwordScopeResolutionsJson = Read-PasswordScopeResolutions $PasswordScopeResolutionsPath }
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
  # Release lane: the reviewed application image must still be the exact
  # attested tag and digest the release wrapper verified, with a clean scan.
  $tag = Get-ReviewedImageTag -Environment $Environment -Commit $Commit
  $image = (Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails | Select-Object -First 1
  if (!$image -or @($image.imageTags) -cnotcontains $tag) { throw "Reviewed application image '$tag' is absent or unverified." }
  Assert-ImageDigest -Actual $image.imageDigest -Expected $ExpectedDigest | Out-Null
  Wait-MigrationImageScan -Digest $ExpectedDigest | Out-Null
  return $image.imageDigest
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
  # One scan gate for both lanes: the scan must report the exact digest being
  # verified, be COMPLETE, and carry zero findings at every severity.
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
function Resolve-ApplicationInspectionImage {
  param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
    [scriptblock]$ScanNow = { [DateTimeOffset]::UtcNow },
    [scriptblock]$ScanSleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
  )
  # Read-only and live final-database actions reuse the immutable application
  # image that deploy-app.ps1 published for this commit. It carries the same
  # migration runner and SQL, so these actions never build or publish an image.
  $tag = "$Commit-aws-native-$Environment"
  try { $details = @((Invoke-Aws @('ecr','describe-images','--repository-name',$settings.Repository,'--image-ids',"imageTag=$tag")).imageDetails) } catch {
    if (-not (Test-EcrImageNotFoundError -ErrorRecord $_)) { throw }
    $details = @()
  }
  if ($details.Count -ne 1 -or [string]$details[0].imageDigest -notmatch '^sha256:[0-9a-f]{64}$') {
    throw "Application image $tag is not present in ECR; refusing to build an image for $Action. Publish it with deploy-app.ps1 first."
  }
  $digest = Wait-MigrationImageScan -Digest ([string]$details[0].imageDigest) -Now $ScanNow -Sleep $ScanSleep
  return @{ Tag=$tag; Digest=$digest }
}
function Assert-LiveInspectionTarget {
  param([Parameter(Mandatory)]$Task)
  # The running service must use the pinned live credential, and the pinned
  # host must be the live instance's RDS endpoint. Fail closed on any drift.
  $secrets = @($Task.containerDefinitions[0].secrets | Where-Object { $_.name -eq 'TRACEPOINT_DATABASE_SECRET_JSON' })
  if ($secrets.Count -ne 1 -or [string]$secrets[0].valueFrom -cne $settings.LiveDatabaseSecretArn) {
    throw 'The running application task does not use the pinned live database secret; refusing live inspection.'
  }
  # Images before this check do not enforce the host pin in-task. The pinned
  # version is the secret's only version, written by the stack whose template
  # sets the live host; refuse if the secret has changed since then.
  $versions = @((Invoke-Aws @('secretsmanager','list-secret-version-ids','--secret-id',$settings.LiveDatabaseSecretArn,'--include-deprecated')).Versions)
  if ($versions.Count -ne 1 -or [string]$versions[0].VersionId -cne $settings.LiveDatabaseSecretVersionId -or @($versions[0].VersionStages) -notcontains 'AWSCURRENT') {
    throw 'The live database secret changed since its host was attested; refusing live inspection.'
  }
  Assert-LiveDatabaseEndpoint
}
function Assert-LiveDatabaseEndpoint {
  $instances = @((Invoke-Aws @('rds','describe-db-instances','--db-instance-identifier',$settings.LiveDatabaseInstance)).DBInstances)
  if ($instances.Count -ne 1 -or $instances[0].DBInstanceStatus -ne 'available' -or [string]$instances[0].Endpoint.Address -cne $settings.LiveDatabaseHost -or [int]$instances[0].Endpoint.Port -ne 5432) {
    throw 'The pinned live database host does not match the live RDS instance endpoint; refusing live inspection and database changes.'
  }
}
function Publish-MigrationImage {
  param(
    [Parameter(Mandatory, Position=0)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
    # The release lane also requires ECR to attest the exact immutable tag.
    [switch]$RequireTagAttestation,
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
    if ($RequireTagAttestation -and @($existing.imageTags) -cnotcontains $tag) { throw 'Existing migration image tag is not attested by ECR.' }
    $digest = Wait-MigrationImageScan -Digest ([string]$existing.imageDigest) -Now $ScanNow -Sleep $ScanSleep
    return @{ Tag=$tag; Digest=$digest }
  }
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-migration-' + [guid]::NewGuid().ToString('N')); $zip = Join-Path $dir 'source.zip'
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    # The Docker validation gates execute scripts directly and the production
    # lint ratchet checks every changed scripts/** file. Archive the complete
    # tree so the immutable build context cannot omit a referenced script.
    $paths = @('.dockerignore','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','lint-baseline.json','public','src','database/aws','database/rehearsal','supabase/migrations','scripts','infra/lib/production-target.ts','Dockerfile','buildspec.staging-image.yml')
    # Already inside 'scripts'; named here as the staging image contract (mobile
    # route checks and the staging-only migration diagnostics).
    if ($Environment -eq 'staging') { $paths += @('scripts/mobile-route-image-contract-core.mjs','scripts/test-staging-image-mobile-routes.sh','scripts/aws-native-migration-diagnostics.mjs') }
    if ($Environment -eq 'production') { $paths = @('.dockerignore','package.json','package-lock.json','next.config.ts','tsconfig.json','eslint.config.mjs','postcss.config.mjs','public','src','database/aws','database/rehearsal','supabase/migrations','scripts','infra/lib/production-target.ts','Dockerfile.aws-native-production','buildspec.production-image.yml') }
    # Staging's migration ledger records the SHA-256 of the CRLF archive bytes,
    # so the staging migration image must be built from an autocrlf=true archive.
    if ($Environment -eq 'staging') { & git.exe -C $root -c core.autocrlf=true archive --format=zip "--output=$zip" $Commit -- @paths }
    else { & git.exe -C $root archive --format=zip "--output=$zip" $Commit -- @paths }
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
  if ($RequireTagAttestation -and @($image.imageTags) -cnotcontains $tag) { throw 'Migration image was not published under its exact immutable commit tag.' }
  $digest = Wait-MigrationImageScan -Digest ([string]$image.imageDigest) -Now $ScanNow -Sleep $ScanSleep
  return @{ Tag=$tag; Digest=$digest }
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
function Invoke-MigrationTask {
  [CmdletBinding(DefaultParameterSetName='Commit')]
  param(
    # Production lane (and its read-only/live actions): one commit, task action = $Action.
    [Parameter(Mandatory, Position=0, ParameterSetName='Commit')][string]$Commit,
    # Release lane: reviewed application image plus a prebuilt, scanned migration image.
    [Parameter(Mandatory, ParameterSetName='Release')][ValidatePattern('^[0-9a-f]{40}$')][string]$ApplicationCommit,
    [Parameter(Mandatory, ParameterSetName='Release')][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ApplicationDigest,
    [Parameter(Mandatory, ParameterSetName='Release')][string]$TaskAction,
    [Parameter(Mandatory, ParameterSetName='Release')][ValidatePattern('^[0-9a-f]{40}$')][string]$MigrationCommit,
    [Parameter(Mandatory, ParameterSetName='Release')][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$MigrationDigest,
    [scriptblock]$ScanNow = { [DateTimeOffset]::UtcNow },
    [scriptblock]$ScanSleep = { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
  )
  $releaseTask = $PSCmdlet.ParameterSetName -eq 'Release'
  # No ValidateSet on TaskAction: PowerShell would re-validate the Commit-lane assignment below.
  if ($releaseTask -and $TaskAction -notin @('status','baseline','reconcile','apply','diagnose')) { throw "Release-lane task action '$TaskAction' is not supported." }
  if (-not $releaseTask) { $TaskAction = $Action; $ApplicationCommit = $Commit }
  if ($Action -eq 'password-scope-039-040' -and [string]::IsNullOrWhiteSpace($passwordScopeResolutionsJson)) { throw 'password-scope-039-040 requires the reviewed resolution list.' }
  if ($Action -in $liveDatabaseChangeActions -and -not $AuthorizeLiveDatabaseChange) { throw "$Action changes the live production database; supply -AuthorizeLiveDatabaseChange only after it is approved." }
  if ($releaseTask) { Assert-ReviewedApplicationImage -Commit $ApplicationCommit -ExpectedDigest $ApplicationDigest | Out-Null }
  $service = (Invoke-Aws @('ecs','describe-services','--cluster',$settings.Cluster,'--services',$settings.Service)).services | Select-Object -First 1
  if (!$service -or $service.status -ne 'ACTIVE') { throw 'Expected ECS application service is not active.' }
  # Production inspect reads the live application database. Its source is the
  # running service revision, never the bootstrap task, whose credentials
  # target the pre-cutover instance.
  $liveInspection = $Action -eq 'inspect' -and $settings.ContainsKey('LiveDatabaseInstance')
  $sourceTaskDefinition = if ($liveInspection) { $service.taskDefinition } elseif ($settings.MigrationTaskDefinition) { $settings.MigrationTaskDefinition } else { $service.taskDefinition }
  $current = (Invoke-Aws @('ecs','describe-task-definition','--task-definition',$sourceTaskDefinition)).taskDefinition
  if ($current.networkMode -ne 'awsvpc' -or @($current.requiresCompatibilities) -notcontains 'FARGATE' -or @($current.containerDefinitions).Count -ne 1) { throw 'Unexpected ECS task pattern.' }
  if ($liveInspection) { Assert-LiveInspectionTarget -Task $current }
  if ($Action -in $liveOwnerActions) { Assert-LiveDatabaseEndpoint }
  # Release lane: the migration image was built and scan-verified once from the
  # release-tooling commit; every task in the sequence pins that same digest.
  if ($releaseTask) { $tag = "migration-$MigrationCommit-aws-native-$Environment" }
  $image = if ($releaseTask) { @{ Tag=$tag; Digest=$MigrationDigest } }
    elseif ($Action -in (@('status','inspect') + $liveOwnerActions)) { Resolve-ApplicationInspectionImage -Commit $Commit -ScanNow $ScanNow -ScanSleep $ScanSleep }
    else { Publish-MigrationImage -Commit $Commit -ScanNow $ScanNow -ScanSleep $ScanSleep }
  if ($releaseTask) { Assert-ImageDigest -Actual $image.Digest -Expected $image.Digest | Out-Null }
  $registration = [ordered]@{}
  if ($liveInspection) {
    # A separate family keeps the service's family free of inspection
    # revisions. No task role: the runner needs no AWS API access.
    $registration.family = $settings.LiveInspectionFamily
    foreach ($field in @('executionRoleArn','networkMode','requiresCompatibilities','cpu','memory','runtimePlatform','ephemeralStorage')) {
      $property = $current.PSObject.Properties[$field]
      if ($null -ne $property -and $null -ne $property.Value) { $registration[$field] = $property.Value }
    }
    $sourceContainer = $current.containerDefinitions[0]
    # The running application's least-privileged credential, never the owner
    # credential, plus the independently pinned host the runner must match.
    $registration.containerDefinitions = @([pscustomobject][ordered]@{
      name = $sourceContainer.name; image = $null; essential = $true; command = @()
      logConfiguration = $sourceContainer.logConfiguration
      secrets = @([ordered]@{ name='TRACEPOINT_DATABASE_SECRET_JSON'; valueFrom=$settings.LiveDatabaseSecretArn })
      environment = @(
        [ordered]@{ name='CONFIGURATION_ENVIRONMENT'; value=$Environment },
        [ordered]@{ name='TRACEPOINT_DATA_PROVIDER'; value='postgres' },
        [ordered]@{ name='TRACEPOINT_RUNTIME_PROVIDER_MODE'; value='aws-native' },
        [ordered]@{ name='TRACEPOINT_DATABASE_CA_PATH'; value='/app/rds-ca.pem' },
        [ordered]@{ name='TRACEPOINT_EXPECTED_DATABASE_HOST'; value=$settings.LiveDatabaseHost },
        [ordered]@{ name='DEPLOYMENT_VERSION'; value=$Commit }
      )
    })
  } else {
    foreach ($field in @('family','taskRoleArn','executionRoleArn','networkMode','containerDefinitions','volumes','placementConstraints','requiresCompatibilities','cpu','memory','runtimePlatform','ephemeralStorage')) {
      $property = $current.PSObject.Properties[$field]
      if ($null -ne $property -and $null -ne $property.Value) { $registration[$field] = $property.Value }
    }
  }
  $container = $registration.containerDefinitions[0]
  $container.image = "$($settings.Account).dkr.ecr.$($settings.Region).amazonaws.com/$($settings.Repository)@$($image.Digest)"
  $container.command = @('scripts/run-aws-native-migrations.mjs',$TaskAction,$Environment)
  Set-MigrationTaskContainerUser $container
  Set-MigrationTaskContainerEntryPoint $container
  if ($releaseTask) {
    # The release lane reads the runner's ledger report back from CloudWatch.
    if ($container.logConfiguration.logDriver -cne 'awslogs') { throw 'Migration task must use CloudWatch awslogs to return its ledger report.' }
    $logOptions = $container.logConfiguration.options
    $logGroup = [string]$logOptions.'awslogs-group'
    $logPrefix = [string]$logOptions.'awslogs-stream-prefix'
    if ([string]::IsNullOrWhiteSpace($logGroup) -or [string]::IsNullOrWhiteSpace($logPrefix) -or [string]$logOptions.'awslogs-region' -cne $settings.Region) { throw 'Migration task CloudWatch log configuration is missing or points to the wrong region.' }
  }
  if ($settings.MigratorSecretArn -and -not $liveInspection) {
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
    # The owner credential keeps its pre-cutover hostname; the runner connects
    # only to this pinned live host for the guarded final-database actions.
    if ($Action -in $liveOwnerActions) { $container.environment += ,([ordered]@{ name='TRACEPOINT_EXPECTED_DATABASE_HOST'; value=$settings.LiveDatabaseHost }) }
    if ($Action -eq 'password-scope-039-040') { $container.environment += ,([ordered]@{ name='TRACEPOINT_PASSWORD_SCOPE_RESOLUTIONS'; value=$passwordScopeResolutionsJson }) }
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
    $report = $null
    if ($releaseTask) {
      $taskId = [string]$task.taskArn.Split('/')[-1]
      $streamName = "$logPrefix/$($container.name)/$taskId"
      $report = Read-MigrationTaskReport -LogGroup $logGroup -StreamName $streamName
      if ($TaskAction -ne 'diagnose') {
        $expectation = if ($TaskAction -eq 'apply') { 'after-apply' } else { 'status' }
        Assert-MigrationLedgerReport -Report $report -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $MigrationCommit -Expectation $expectation | Out-Null
      }
    }
    Write-Host "AWS-native migration task succeeded: $($task.taskArn); image $($image.Digest)."
    if ($releaseTask) { return $report }
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
if ($releaseLane) {
  # Migration-first release lane: status -> before-apply assert -> apply ->
  # after-apply assert -> entitlement record -> status.
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
  $migrationImage = Publish-MigrationImage $toolingCommit -RequireTagAttestation
  $taskImage = @{ ApplicationCommit=$applicationCommit; ApplicationDigest=$applicationDigest; MigrationCommit=$toolingCommit; MigrationDigest=$migrationImage.Digest }
  if ($Action -eq 'apply') {
    $before = Invoke-MigrationTask @taskImage -TaskAction 'status'
    Assert-MigrationLedgerReport -Report $before -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation 'before-apply' | Out-Null
    $result = Invoke-MigrationTask @taskImage -TaskAction 'apply'
    Assert-MigrationLedgerReport -Report $result -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation 'after-apply' | Out-Null
    Assert-EntitlementMigrationRecord -Report $result -ApplicationCommit $applicationCommit -Environment $Environment | Out-Null
    $after = Invoke-MigrationTask @taskImage -TaskAction 'status'
    Assert-MigrationLedgerReport -Report $after -MigrationFiles $migrationFiles -RepositoryRoot $root -MigrationCommit $toolingCommit -Expectation 'after-apply' | Out-Null
    Assert-EntitlementMigrationRecord -Report $after -ApplicationCommit $applicationCommit -Environment $Environment | Out-Null
    return $after
  }
  $result = Invoke-MigrationTask @taskImage -TaskAction $Action
  return $result
}

# Production lane.
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
