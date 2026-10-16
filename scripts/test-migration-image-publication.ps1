Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourcePath = Join-Path $PSScriptRoot 'apply-app-migrations.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Migration publisher parser errors: $($parseErrors -join '; ')" }
$requiredFunctionNames = @(
    'Test-EcrImageNotFoundError', 'Wait-MigrationImageScan', 'Resolve-ApplicationInspectionImage', 'Publish-MigrationImage', 'Invoke-MigrationTask',
    'Get-OptionalPropertyValue', 'Get-ReportedValue', 'Get-MigrationTaskFailureDetails',
    'Set-MigrationTaskContainerUser', 'Set-MigrationTaskContainerEntryPoint'
)
$functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $requiredFunctionNames }, $true))
foreach ($name in $requiredFunctionNames) {
    if (-not ($functions | Where-Object Name -eq $name)) { throw "Migration publisher function '$name' was not found." }
}
foreach ($function in $functions) { . ([scriptblock]::Create($function.Extent.Text)) }

$Environment = 'staging'
$Action = 'status'
$settings = @{ Account='559054714699'; Profile='synthetic-profile'; Repository='tracepoint-staging'; Bucket='synthetic-bucket'; Key='source.zip'; Build='synthetic-build'; Region='us-east-1'; Cluster='tracepoint-staging'; Service='tracepoint-staging'; MigrationTaskDefinition='tracepoint-staging-database-bootstrap:27'; MigratorSecretArn='synthetic-secret-arn' }
$root = $repositoryRoot
$global:MigrationScanScenario = 'clean'
$global:MigrationImageMode = 'reuse'
$global:MigrationBuildStarted = $false
$global:MigrationBuildCount = 0
$global:MigrationRunTaskCount = 0
$global:MigrationRegisterTaskCount = 0
$global:MigrationTagLookupCount = 0
$global:MigrationScanCallCount = 0
$global:MigrationScannedDigests = @()
$global:MigrationRegisteredImage = $null
$global:MigrationClock = [DateTimeOffset]::Parse('2026-10-15T12:00:00Z')
$goodDigest = 'sha256:' + ('a' * 64)
$movedDigest = 'sha256:' + ('b' * 64)

function Invoke-Aws {
    param([string[]]$Arguments)
    $global:MigrationAwsCalls += "$($Arguments[0]) $($Arguments[1])"
    if ($Arguments[0] -eq 'ecs' -and $Arguments[1] -eq 'describe-services') {
        return [pscustomobject]@{ services=@([pscustomobject]@{status='ACTIVE';taskDefinition='arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint:27';networkConfiguration=[pscustomobject]@{awsvpcConfiguration=[pscustomobject]@{subnets=@('subnet-synthetic');securityGroups=@('sg-synthetic');assignPublicIp='DISABLED'}}}) }
    }
    if ($Arguments[0] -eq 'ecs' -and $Arguments[1] -eq 'describe-task-definition') {
        return [pscustomobject]@{ taskDefinition=[pscustomobject]@{family='tracepoint-migration';taskRoleArn='arn:aws:iam::559054714699:role/existing-task';executionRoleArn='arn:aws:iam::559054714699:role/existing-execution';networkMode='awsvpc';requiresCompatibilities=@('FARGATE');containerDefinitions=@([pscustomobject]@{name='tracepoint';image='old-image';command=@();user='node';entryPoint=@('node');secrets=@();environment=@();portMappings=@([pscustomobject]@{containerPort=3000})})} }
    }
    if ($Arguments[0] -eq 'ecr' -and $Arguments[1] -eq 'describe-images') {
        $global:MigrationTagLookupCount++
        $global:MigrationRequestedImageIds += [string]$Arguments[-1]
        if ($global:MigrationImageMode -eq 'missing') {
            throw 'AWS command failed: An error occurred (ImageNotFoundException) when calling the DescribeImages operation: Image not found.'
        }
        if ($global:MigrationImageMode -eq 'empty') { return @{ imageDetails=@() } }
        if ($global:MigrationImageMode -eq 'build' -and -not $global:MigrationBuildStarted) {
            throw 'AWS command failed: An error occurred (ImageNotFoundException) when calling the DescribeImages operation: Image not found.'
        }
        if ($global:MigrationImageMode -eq 'build' -and -not $global:MigrationBuildStarted) { return @{ imageDetails=@() } }
        if ($global:MigrationImageMode -eq 'reuse') { return @{ imageDetails=@(@{imageDigest=$goodDigest}) } }
        return @{ imageDetails=@(@{imageDigest=$goodDigest}) }
    }
    if ($Arguments[0] -eq 'ecr' -and $Arguments[1] -eq 'describe-image-scan-findings') {
        $digest = [string]$Arguments[-1] -replace '^imageDigest=', ''
        $global:MigrationScannedDigests += $digest
        $global:MigrationScanCallCount++
        switch ($global:MigrationScanScenario) {
            'unavailable' { throw 'AWS command failed: An error occurred (AccessDeniedException) when calling the DescribeImageScanFindings operation.' }
            'timeout' { $status='IN_PROGRESS'; $findings=@{HIGH=0}; $reportedDigest=$digest }
            'incomplete' { $status='UNSUPPORTED_IMAGE'; $findings=@{HIGH=0}; $reportedDigest=$digest }
            'failed' { $status='FAILED'; $findings=@{HIGH=0}; $reportedDigest=$digest }
            'findings' { $status='COMPLETE'; $findings=@{HIGH=1}; $reportedDigest=$digest }
            'digest-mismatch' { $status='COMPLETE'; $findings=@{HIGH=0}; $reportedDigest=$movedDigest }
            'progress-then-clean' {
                $status = if ($global:MigrationScanCallCount -eq 1) { 'IN_PROGRESS' } else { 'COMPLETE' }
                $findings=@{HIGH=0}; $reportedDigest=$digest
            }
            default { $status='COMPLETE'; $findings=@{HIGH=0}; $reportedDigest=$digest }
        }
        return @{ imageId=@{imageDigest=$reportedDigest}; imageScanStatus=@{status=$status}; imageScanFindings=@{findingSeverityCounts=[pscustomobject]$findings} }
    }
    if ($Arguments[0] -eq 's3api' -and $Arguments[1] -eq 'put-object') { return @{VersionId='synthetic-version'} }
    if ($Arguments[0] -eq 'codebuild' -and $Arguments[1] -eq 'start-build') {
        $global:MigrationBuildCount++
        $global:MigrationBuildStarted=$true
        return @{build=@{id='synthetic-build-id'}}
    }
    if ($Arguments[0] -eq 'codebuild' -and $Arguments[1] -eq 'batch-get-builds') { return @{builds=@(@{buildStatus='SUCCEEDED'})} }
    if ($Arguments[0] -eq 'ecs' -and $Arguments[1] -eq 'register-task-definition') {
        $global:MigrationRegisterTaskCount++
        $index = [Array]::IndexOf($Arguments, '--cli-input-json')
        $path = $Arguments[$index + 1].Substring('file://'.Length)
        $registeredContainer = (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).containerDefinitions[0]
        $global:MigrationRegisteredImage = $registeredContainer.image
        $global:MigrationRegisteredCommand = @($registeredContainer.command) -join ' '
        $global:MigrationRegisteredSecrets = @($registeredContainer.secrets | ForEach-Object { "$($_.name)=$($_.valueFrom)" }) -join ','
        return @{taskDefinition=@{taskDefinitionArn='arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-migration:99'}}
    }
    if ($Arguments[0] -eq 'ecs' -and $Arguments[1] -eq 'run-task') {
        $global:MigrationRunTaskCount++
        $index = [Array]::IndexOf($Arguments, '--overrides')
        $path = $Arguments[$index + 1].Substring('file://'.Length)
        $global:MigrationOverrideCommand = @((Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).containerOverrides[0].command) -join ' '
        return @{tasks=@(@{taskArn='arn:aws:ecs:us-east-1:559054714699:task/tracepoint-migration/synthetic'})}
    }
    if ($Arguments[0] -eq 'ecs' -and $Arguments[1] -eq 'describe-tasks') {
        return [pscustomobject]@{tasks=@([pscustomobject]@{stopCode='EssentialContainerExited';stoppedReason='Synthetic completion';containers=@([pscustomobject]@{name='tracepoint';exitCode=0})})}
    }
    throw "Unexpected mocked AWS call: $($Arguments -join ' ')"
}
function git.exe {
    $global:LASTEXITCODE = 0
    $joined = $args -join ' '
    if ($joined -match 'diff --name-only') { return 'scripts/run-aws-native-migrations.mjs' }
}
function aws.exe { $global:LASTEXITCODE = 0 }
function Start-Sleep { param([int]$Seconds) }

$scanClock = { $global:MigrationClock }
$scanSleep = { param([int]$Seconds) $global:MigrationClock = $global:MigrationClock.AddSeconds($Seconds) }
function Reset-MigrationScenario([string]$Mode, [string]$Scan) {
    $global:MigrationImageMode=$Mode
    $global:MigrationScanScenario=$Scan
    $global:MigrationBuildStarted=$false
    $global:MigrationBuildCount=0
    $global:MigrationRunTaskCount=0
    $global:MigrationRegisterTaskCount=0
    $global:MigrationTagLookupCount=0
    $global:MigrationScanCallCount=0
    $global:MigrationScannedDigests=@()
    $global:MigrationRegisteredImage=$null
    $global:MigrationRegisteredCommand=$null
    $global:MigrationRegisteredSecrets=$null
    $global:MigrationOverrideCommand=$null
    $global:MigrationRequestedImageIds=@()
    $global:MigrationAwsCalls=@()
    $global:MigrationClock=[DateTimeOffset]::Parse('2026-10-15T12:00:00Z')
}

# Mutating actions keep the dedicated migration image and its build path.
$Action = 'apply'
foreach ($case in @(
    @{Mode='reuse';Scan='unavailable'},
    @{Mode='reuse';Scan='incomplete'},
    @{Mode='reuse';Scan='failed'},
    @{Mode='reuse';Scan='findings'},
    @{Mode='reuse';Scan='digest-mismatch'},
    @{Mode='reuse';Scan='timeout'},
    @{Mode='build';Scan='unavailable'},
    @{Mode='build';Scan='failed'},
    @{Mode='build';Scan='findings'}
)) {
    Reset-MigrationScenario -Mode $case.Mode -Scan $case.Scan
    $failed=$false
    try { Invoke-MigrationTask -Commit ('a' * 40) -ScanNow $scanClock -ScanSleep $scanSleep } catch { $failed=$true }
    if (-not $failed) { throw "Migration task path accepted $($case.Mode) image scan case '$($case.Scan)'." }
    if ($global:MigrationRunTaskCount -ne 0 -or $global:MigrationRegisterTaskCount -ne 0) { throw "ECS task work began after $($case.Mode) image scan failure '$($case.Scan)'." }
    if ($case.Mode -eq 'build' -and $global:MigrationBuildCount -ne 1) { throw 'Build-path scan failure did not exercise exactly one mocked image build.' }
}

foreach ($mode in @('reuse','build')) {
    Reset-MigrationScenario -Mode $mode -Scan 'progress-then-clean'
    Invoke-MigrationTask -Commit ('a' * 40) -ScanNow $scanClock -ScanSleep $scanSleep
    $expectedImage = "559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging@$goodDigest"
    if ($global:MigrationRunTaskCount -ne 1 -or $global:MigrationRegisterTaskCount -ne 1) { throw "The clean $mode image did not start exactly one mocked task." }
    if ($global:MigrationRegisteredImage -ne $expectedImage) { throw "The clean $mode image task did not use the exact digest that passed scan: $($global:MigrationRegisteredImage)" }
    if (@($global:MigrationScannedDigests | Select-Object -Unique).Count -ne 1 -or $global:MigrationScannedDigests[0] -ne $goodDigest) { throw "The clean $mode path did not scan the pinned image digest." }
    if ($mode -eq 'build' -and $global:MigrationBuildCount -ne 1) { throw 'The clean build path did not perform exactly one mocked build.' }
    if ($mode -eq 'reuse' -and $global:MigrationTagLookupCount -ne 1) { throw 'The reused image tag was looked up again after scan instead of using its pinned digest.' }
    if (@($global:MigrationRequestedImageIds | Where-Object { $_ -ne "imageTag=migration-$('a' * 40)-aws-native-staging" }).Count -ne 0) { throw "The apply action stopped using its dedicated migration image tag: $($global:MigrationRequestedImageIds -join ', ')" }
    if ($global:MigrationRegisteredCommand -ne 'scripts/run-aws-native-migrations.mjs apply staging') { throw 'The apply action did not keep its migration command.' }
}

# Read-only actions reuse the immutable application image and never build.
$readOnlyAllowedCalls = @('ecs describe-services','ecs describe-task-definition','ecr describe-images','ecr describe-image-scan-findings','ecs register-task-definition','ecs run-task','ecs describe-tasks')
foreach ($readOnlyAction in @('status','inspect')) {
    $Action = $readOnlyAction
    $applicationTag = "imageTag=$('a' * 40)-aws-native-staging"

    foreach ($mode in @('missing','empty')) {
        Reset-MigrationScenario -Mode $mode -Scan 'clean'
        $failure = $null
        try { Invoke-MigrationTask -Commit ('a' * 40) -ScanNow $scanClock -ScanSleep $scanSleep } catch { $failure = $_.Exception.Message }
        if (-not $failure -or $failure -notmatch 'refusing to build an image for read-only') { throw "Read-only $readOnlyAction accepted a $mode application image: $failure" }
        if ($global:MigrationBuildCount -ne 0 -or @($global:MigrationAwsCalls | Where-Object { $_ -match '^(codebuild|s3api) ' }).Count -ne 0) { throw "Read-only $readOnlyAction started a source upload or image build for a $mode image." }
        if ($global:MigrationRegisterTaskCount -ne 0 -or $global:MigrationRunTaskCount -ne 0) { throw "Read-only $readOnlyAction began ECS task work without an application image." }
        if ((@($global:MigrationRequestedImageIds) -join ',') -ne $applicationTag) { throw "Read-only $readOnlyAction did not look up only the application tag: $($global:MigrationRequestedImageIds -join ', ')" }
    }

    foreach ($scan in @('unavailable','incomplete','failed','findings','digest-mismatch','timeout')) {
        Reset-MigrationScenario -Mode 'reuse' -Scan $scan
        $failed = $false
        try { Invoke-MigrationTask -Commit ('a' * 40) -ScanNow $scanClock -ScanSleep $scanSleep } catch { $failed = $true }
        if (-not $failed) { throw "Read-only $readOnlyAction accepted application image scan case '$scan'." }
        if ($global:MigrationRegisterTaskCount -ne 0 -or $global:MigrationRunTaskCount -ne 0 -or $global:MigrationBuildCount -ne 0) { throw "Read-only $readOnlyAction began task or build work after scan case '$scan'." }
    }

    Reset-MigrationScenario -Mode 'reuse' -Scan 'progress-then-clean'
    Invoke-MigrationTask -Commit ('a' * 40) -ScanNow $scanClock -ScanSleep $scanSleep
    if ($global:MigrationRegisterTaskCount -ne 1 -or $global:MigrationRunTaskCount -ne 1 -or $global:MigrationBuildCount -ne 0) { throw "Read-only $readOnlyAction did not start exactly one task without building." }
    if ((@($global:MigrationRequestedImageIds) -join ',') -ne $applicationTag) { throw "Read-only $readOnlyAction did not resolve only the application tag." }
    if ($global:MigrationRegisteredImage -ne "559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging@$goodDigest") { throw "Read-only $readOnlyAction did not pin the scanned application digest." }
    if ((@($global:MigrationScannedDigests | Select-Object -Unique) -join ',') -ne $goodDigest) { throw "Read-only $readOnlyAction did not scan the pinned application digest." }
    $expectedCommand = "scripts/run-aws-native-migrations.mjs $readOnlyAction staging"
    if ($global:MigrationRegisteredCommand -ne $expectedCommand -or $global:MigrationOverrideCommand -ne $expectedCommand) { throw "Read-only $readOnlyAction task command changed: $($global:MigrationRegisteredCommand) / $($global:MigrationOverrideCommand)" }
    if ($global:MigrationRegisteredSecrets -ne 'TRACEPOINT_DATABASE_SECRET_JSON=synthetic-secret-arn') { throw "Read-only $readOnlyAction did not keep the single migrator database secret." }
    $unexpected = @($global:MigrationAwsCalls | Where-Object { $readOnlyAllowedCalls -notcontains $_ })
    if ($unexpected.Count -ne 0) { throw "Read-only $readOnlyAction made unexpected AWS calls: $($unexpected -join ', ')" }
}

# Production read-only actions resolve the tag deploy-app.ps1 publishes.
$stagingEnvironment = $Environment
$stagingSettings = $settings
$Environment = 'production'
$settings = @{ Account='193644343389'; Profile='synthetic-profile'; Repository='tracepoint-production'; Bucket='synthetic-bucket'; Key='source.zip'; Build='synthetic-build'; Region='us-east-1'; Cluster='tracepoint-production'; Service='tracepoint-production'; MigrationTaskDefinition='tracepoint-production-database-bootstrap:3'; MigratorSecretArn='synthetic-production-secret-arn' }
foreach ($readOnlyAction in @('status','inspect')) {
    $Action = $readOnlyAction
    Reset-MigrationScenario -Mode 'reuse' -Scan 'clean'
    Invoke-MigrationTask -Commit ('a' * 40) -ScanNow $scanClock -ScanSleep $scanSleep
    if ((@($global:MigrationRequestedImageIds) -join ',') -ne "imageTag=$('a' * 40)-aws-native-production") { throw "Production read-only $readOnlyAction did not resolve the deployed application tag." }
    if ($global:MigrationRegisteredImage -ne "193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@$goodDigest") { throw "Production read-only $readOnlyAction did not pin the application digest." }
    if ($global:MigrationRegisteredCommand -ne "scripts/run-aws-native-migrations.mjs $readOnlyAction production" -or $global:MigrationBuildCount -ne 0) { throw "Production read-only $readOnlyAction changed its command or built an image." }
}
$Environment = $stagingEnvironment
$settings = $stagingSettings

Write-Host 'Migration image scan gate tests passed: reuse/build failures launched zero ECS tasks; incomplete, unavailable, failed, findings, mismatch, timeout all blocked; clean scans launched one task pinned to the checked digest; apply keeps the migration image; status and inspect reuse only the scanned application image, never build, and make no service update. AWS/ECR/CodeBuild/ECS were mocked.'
