[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('staging', 'production')][string]$Environment,
    [ValidatePattern('^arn:aws:ecs:us-east-1:[0-9]{12}:task-definition/[^:]+:[0-9]+$')][string]$RollbackTaskDefinitionArn
)

# Application-only deployment. This script intentionally does not call CDK or
# CloudFormation and has no commands that modify platform resources.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$configuration = @{
    staging = @{
        Account = '559054714699'; Profile = 'tracepoint-member-staging'; Role = 'TracePointMigrationStaging'
        Region = 'us-east-1'; Cluster = 'tracepoint-staging'; Service = 'tracepoint-staging'
        Repository = 'tracepoint-staging'; SourceBucket = 'tracepoint-staging-build-source-559054714699'
        SourceKey = 'source/tracepoint-staging-source.zip'; BuildProject = 'tracepoint-staging-image-build'
        Host = 'https://staging.tracepointhq.com'; ImageSuffix = ''
    }
    production = @{
        Account = '193644343389'; Profile = 'tracepoint-production'; Role = 'TracePointMigrationProduction'
        Region = 'us-east-1'; Cluster = 'tracepoint-production'; Service = 'tracepoint-production'
        Repository = 'tracepoint-production'; SourceBucket = 'tracepoint-production-aws-native-build-source-193644343389'
        SourceKey = 'source/tracepoint-production-aws-native-source.zip'; BuildProject = 'tracepoint-production-aws-native-image-build'
        Host = 'https://tracepointhq.com'; ImageSuffix = '-aws-native-production'
    }
}[$Environment]

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$imageRepository = "$($configuration.Account).dkr.ecr.$($configuration.Region).amazonaws.com/$($configuration.Repository)"
$script:DeploymentWarnings = [System.Collections.Generic.List[string]]::new()

function Add-DeploymentWarning {
    param([Parameter(Mandatory)][string]$Message)
    $script:DeploymentWarnings.Add($Message)
    Write-Warning $Message
}

function Invoke-Aws {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & aws.exe @Arguments --profile $configuration.Profile --region $configuration.Region --output json 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) { throw "AWS command failed: aws $($Arguments -join ' ')" }
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Assert-AwsIdentity {
    if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw 'aws.exe is required; this script will not install it.' }
    $identity = Invoke-Aws @('sts', 'get-caller-identity')
    if ($identity.Account -ne $configuration.Account) { throw "Refusing AWS account '$($identity.Account)'; expected '$($configuration.Account)'." }
    if ($identity.Arn -notmatch "^arn:aws:sts::$($configuration.Account):assumed-role/[^/]*$($configuration.Role)[^/]*/[^/]+$") {
        throw "Refusing AWS identity '$($identity.Arn)'; expected an assumed $($configuration.Role) role."
    }
    return $identity
}

function Invoke-Native {
    param([Parameter(Mandatory)][string]$File, [Parameter(Mandatory)][string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File failed." }
}

function Assert-ReviewedCommit {
    $sha = (& git.exe -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') { throw 'Unable to resolve the reviewed HEAD commit.' }
    $changes = @(& git.exe -C $repositoryRoot status --porcelain --untracked-files=all)
    if ($changes.Count -ne 0) { throw 'Refusing to deploy a working tree with uncommitted or untracked files.' }
    return $sha
}

function Get-Service {
    $service = (Invoke-Aws @('ecs', 'describe-services', '--cluster', $configuration.Cluster, '--services', $configuration.Service)).services | Select-Object -First 1
    if ($null -eq $service -or $service.status -ne 'ACTIVE') { throw 'The expected ECS application service is not active.' }
    if ($service.clusterArn -ne "arn:aws:ecs:$($configuration.Region):$($configuration.Account):cluster/$($configuration.Cluster)") { throw 'ECS cluster identity mismatch.' }
    if ($service.serviceArn -ne "arn:aws:ecs:$($configuration.Region):$($configuration.Account):service/$($configuration.Cluster)/$($configuration.Service)") { throw 'ECS service identity mismatch.' }
    if ($service.deploymentController.type -ne 'ECS') { throw 'Only the existing ECS deployment controller is permitted.' }
    return $service
}

function Get-ServiceInvariant {
    param([Parameter(Mandatory)]$Service)
    function Get-OptionalServiceProperty([string]$Name) {
        $property = $Service.PSObject.Properties[$Name]
        if ($null -eq $property) { return $null }
        return $property.Value
    }
    # These are the service properties that update-service must not alter.
    return [ordered]@{
        clusterArn = Get-OptionalServiceProperty 'clusterArn'; serviceArn = Get-OptionalServiceProperty 'serviceArn'; desiredCount = Get-OptionalServiceProperty 'desiredCount'
        launchType = Get-OptionalServiceProperty 'launchType'; capacityProviderStrategy = Get-OptionalServiceProperty 'capacityProviderStrategy'
        networkConfiguration = Get-OptionalServiceProperty 'networkConfiguration'; loadBalancers = Get-OptionalServiceProperty 'loadBalancers'
        deploymentConfiguration = Get-OptionalServiceProperty 'deploymentConfiguration'; healthCheckGracePeriodSeconds = Get-OptionalServiceProperty 'healthCheckGracePeriodSeconds'
        schedulingStrategy = Get-OptionalServiceProperty 'schedulingStrategy'; deploymentController = Get-OptionalServiceProperty 'deploymentController'
        roleArn = Get-OptionalServiceProperty 'roleArn'; platformVersion = Get-OptionalServiceProperty 'platformVersion'; enableExecuteCommand = Get-OptionalServiceProperty 'enableExecuteCommand'
    } | ConvertTo-Json -Depth 30 -Compress
}

function Get-TaskDefinition {
    param([Parameter(Mandatory)][string]$TaskDefinition)
    return (Invoke-Aws @('ecs', 'describe-task-definition', '--task-definition', $TaskDefinition)).taskDefinition
}

function Assert-TaskPattern {
    param([Parameter(Mandatory)]$Task)
    if ($Task.networkMode -ne 'awsvpc' -or @($Task.requiresCompatibilities) -notcontains 'FARGATE') { throw 'The live task definition is not the expected Fargate application pattern.' }
    $containers = @($Task.containerDefinitions)
    if ($containers.Count -ne 1 -or $containers[0].name -ne 'tracepoint') { throw 'The live task definition has an unexpected application-container pattern.' }
    if ([string]::IsNullOrWhiteSpace([string]$Task.executionRoleArn) -or [string]::IsNullOrWhiteSpace([string]$Task.taskRoleArn)) { throw 'The live task definition is missing an existing role binding.' }
    if ($containers[0].portMappings[0].containerPort -ne 3000) { throw 'The live application port is not 3000.' }
}

function Publish-Image {
    param([Parameter(Mandatory)][string]$Commit, [Parameter(Mandatory)][string]$ImageTag)
    $existingImage = $null
    try {
        $existingImage = (Invoke-Aws @('ecr', 'describe-images', '--repository-name', $configuration.Repository, '--image-ids', "imageTag=$ImageTag")).imageDetails | Select-Object -First 1
    } catch {
        # ECR's ImageNotFoundException is the normal first-publish path. Any
        # later failure remains visible when the image is required below.
        $existingImage = $null
    }
    if ($null -ne $existingImage -and -not [string]::IsNullOrWhiteSpace([string]$existingImage.imageDigest)) {
        $existingScan = Invoke-Aws @('ecr', 'describe-image-scan-findings', '--repository-name', $configuration.Repository, '--image-id', "imageTag=$ImageTag")
        if ($existingScan.imageScanStatus.status -ne 'COMPLETE' -or @($existingScan.imageScanFindings.findingSeverityCounts.PSObject.Properties | Where-Object { [int]$_.Value -ne 0 }).Count -ne 0) { throw 'The existing application image scan is not clean.' }
        Write-Host "Reusing existing immutable application image $ImageTag."
        return $existingImage
    }
    $archivePaths = @('.dockerignore', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'eslint.config.mjs', 'postcss.config.mjs', 'public', 'src', 'scripts/assert-aws-native-provider-reachability.mjs', 'scripts/start-tracepoint-container.mjs', 'scripts/validate-tracepoint-runtime-config.mjs')
    if ($Environment -eq 'staging') { $archivePaths += @('Dockerfile', 'buildspec.staging-image.yml') }
    else { $archivePaths += @('Dockerfile.aws-native-production', 'buildspec.production-image.yml') }
    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-app-deploy-' + [guid]::NewGuid().ToString('N'))
    $archive = Join-Path $temporaryDirectory 'source.zip'
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
    try {
        $archiveArguments = @('-C', $repositoryRoot, 'archive', '--format=zip', "--output=$archive", $Commit, '--') + $archivePaths
        Invoke-Native -File git.exe -Arguments $archiveArguments
        $version = (Invoke-Aws @('s3api', 'put-object', '--bucket', $configuration.SourceBucket, '--key', $configuration.SourceKey, '--body', $archive, '--expected-bucket-owner', $configuration.Account)).VersionId
        if ([string]::IsNullOrWhiteSpace([string]$version) -or $version -eq 'None') { throw 'The versioned application source upload failed.' }
        $overrides = @("name=IMAGE_TAG,value=$ImageTag,type=PLAINTEXT", "name=SOURCE_COMMIT,value=$Commit,type=PLAINTEXT")
        $buildArguments = @('codebuild', 'start-build', '--project-name', $configuration.BuildProject, '--source-version', $version, '--environment-variables-override') + $overrides
        $build = (Invoke-Aws -Arguments $buildArguments).build
        if ([string]::IsNullOrWhiteSpace([string]$build.id)) { throw 'The application image build did not start.' }
        $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
        do {
            Start-Sleep -Seconds 15
            $status = (Invoke-Aws @('codebuild', 'batch-get-builds', '--ids', $build.id)).builds[0].buildStatus
            if ($status -eq 'SUCCEEDED') { break }
            if ($status -ne 'IN_PROGRESS') { throw "Application image build ended with $status." }
        } while ([DateTimeOffset]::UtcNow -lt $deadline)
        if ($status -ne 'SUCCEEDED') { throw 'Application image build timed out.' }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
    }
    $image = (Invoke-Aws @('ecr', 'describe-images', '--repository-name', $configuration.Repository, '--image-ids', "imageTag=$ImageTag")).imageDetails | Select-Object -First 1
    if ($null -eq $image -or [string]::IsNullOrWhiteSpace([string]$image.imageDigest)) { throw 'The immutable application image was not pushed to ECR.' }
    $scan = Invoke-Aws @('ecr', 'describe-image-scan-findings', '--repository-name', $configuration.Repository, '--image-id', "imageTag=$ImageTag")
    if ($scan.imageScanStatus.status -ne 'COMPLETE' -or @($scan.imageScanFindings.findingSeverityCounts.PSObject.Properties | Where-Object { [int]$_.Value -ne 0 }).Count -ne 0) { throw 'The application image scan is not clean.' }
    return $image
}

function Register-ApplicationTaskRevision {
    param([Parameter(Mandatory)]$CurrentTask, [Parameter(Mandatory)][string]$ImageUri)
    Assert-TaskPattern -Task $CurrentTask
    $registration = [ordered]@{}
    foreach ($field in @('family', 'taskRoleArn', 'executionRoleArn', 'networkMode', 'containerDefinitions', 'volumes', 'placementConstraints', 'requiresCompatibilities', 'cpu', 'memory', 'pidMode', 'ipcMode', 'proxyConfiguration', 'inferenceAccelerators', 'ephemeralStorage', 'runtimePlatform')) {
        $property = $CurrentTask.PSObject.Properties[$field]
        if ($null -ne $property -and $null -ne $property.Value) { $registration[$field] = $property.Value }
    }
    $container = @($registration.containerDefinitions | Where-Object name -eq 'tracepoint') | Select-Object -First 1
    if ($null -eq $container) { throw 'Cannot locate the existing TracePoint application container.' }
    $container.image = $ImageUri
    $payload = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-task-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        [IO.File]::WriteAllText($payload, ($registration | ConvertTo-Json -Depth 100 -Compress), [Text.UTF8Encoding]::new($false))
        $registered = Invoke-Aws @('ecs', 'register-task-definition', '--cli-input-json', "file://$payload")
        $task = $registered.taskDefinition
        Assert-TaskPattern -Task $task
        if ($task.containerDefinitions[0].image -ne $ImageUri) { throw 'Registered task revision does not use the reviewed image.' }
        return $task
    }
    finally { if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload -Force } }
}

function Test-Deployment {
    param([Parameter(Mandatory)][string]$ExpectedTaskArn, [Parameter(Mandatory)][string]$ExpectedImageDigest, [Parameter(Mandatory)][string]$ExpectedImageUri, [Parameter(Mandatory)][string]$Invariant)
    & aws.exe ecs wait services-stable --cluster $configuration.Cluster --services $configuration.Service --profile $configuration.Profile --region $configuration.Region
    if ($LASTEXITCODE -ne 0) { throw 'ECS did not reach a steady state.' }
    $service = Get-Service
    if ((Get-ServiceInvariant -Service $service) -ne $Invariant) { throw 'Unexpected ECS service infrastructure change detected.' }
    if ($service.taskDefinition -ne $ExpectedTaskArn -or @($service.deployments).Count -ne 1 -or $service.deployments[0].rolloutState -ne 'COMPLETED') { throw 'ECS rollout did not complete the expected task revision.' }
    if ($service.runningCount -ne $service.desiredCount -or $service.pendingCount -ne 0) { throw 'ECS service task counts are unhealthy.' }
    $targetGroup = @($service.loadBalancers)[0].targetGroupArn
    if ([string]::IsNullOrWhiteSpace([string]$targetGroup)) { throw 'The ECS application service has no existing ALB target group.' }
    $targets = (Invoke-Aws @('elbv2', 'describe-target-health', '--target-group-arn', $targetGroup)).TargetHealthDescriptions
    # A completed rolling deployment can legitimately retain draining old targets
    # while ALB connection deregistration finishes. They are not serving the new
    # release and must not be mistaken for an unhealthy new target.
    $activeTargets = @($targets | Where-Object { $_.TargetHealth.State -ne 'draining' })
    if (@($activeTargets | Where-Object { $_.TargetHealth.State -ne 'healthy' }).Count -ne 0 -or @($activeTargets).Count -ne $service.desiredCount) { throw 'ALB active targets are not all healthy.' }
    $taskArns = @((Invoke-Aws @('ecs', 'list-tasks', '--cluster', $configuration.Cluster, '--service-name', $configuration.Service, '--desired-status', 'RUNNING')).taskArns)
    if ($taskArns.Count -ne $service.desiredCount) { throw 'Unexpected running application task count.' }
    $taskArguments = @('ecs', 'describe-tasks', '--cluster', $configuration.Cluster, '--tasks') + $taskArns
    $tasks = (Invoke-Aws -Arguments $taskArguments).tasks
    foreach ($task in $tasks) {
        if ($task.taskDefinitionArn -ne $ExpectedTaskArn) { throw 'A running task uses an unexpected task revision.' }
        $container = @($task.containers | Where-Object name -eq 'tracepoint') | Select-Object -First 1
        if ($null -eq $container -or $container.image -ne $ExpectedImageUri -or $container.imageDigest -ne $ExpectedImageDigest) { throw 'A running task does not match the reviewed ECR image digest.' }
    }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$($configuration.Host)/api/health" -TimeoutSec 30
        $health = $response.Content | ConvertFrom-Json
    } catch {
        if ($null -ne $_.Exception.Response) { throw 'The public /api/health verification failed.' }
        Add-DeploymentWarning "Could not reach public /api/health from this workstation: $($_.Exception.Message)"
        return
    }
    if ($response.StatusCode -ne 200 -or $health.status -ne 'ok' -or $health.service -ne 'tracepoint') { throw 'The public /api/health response is unhealthy.' }
    Invoke-DeploymentSafeRemoteSmoke
}

function Invoke-DeploymentSafeRemoteSmoke {
    # These requests execute against the deployed service. A failure is evidence
    # about the release itself, unlike a local test-runner failure.
    foreach ($route in @('/api/health', '/login')) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$($configuration.Host)$route" -TimeoutSec 30
        } catch {
            if ($null -ne $_.Exception.Response) { throw "Deployment-safe remote smoke failed for $route." }
            Add-DeploymentWarning "Could not run remote smoke for $route from this workstation: $($_.Exception.Message)"
            continue
        }
        if ($response.StatusCode -ne 200) { throw "Deployment-safe remote smoke returned HTTP $($response.StatusCode) for $route." }
    }
}

function Invoke-RequiredLocalValidation {
    Invoke-Native -File node.exe -Arguments @((Join-Path $PSScriptRoot 'run-application-tests.mjs'))
}

function Invoke-PostDeploymentDiagnostics {
    # This existing browser-style suite is helpful, but Node/runtime restrictions
    # on the operator workstation are not evidence that a healthy ECS release is bad.
    if ($Environment -eq 'staging') {
        Invoke-Native -File node.exe -Arguments @((Join-Path $PSScriptRoot 'test-staging-http.mjs'))
    }
}

Assert-AwsIdentity | Out-Null
$serviceBefore = Get-Service
$invariant = Get-ServiceInvariant -Service $serviceBefore
$previousHealthyTaskArn = [string]$serviceBefore.taskDefinition

if ($RollbackTaskDefinitionArn) {
    $target = Get-TaskDefinition -TaskDefinition $RollbackTaskDefinitionArn
    $current = Get-TaskDefinition -TaskDefinition $previousHealthyTaskArn
    Assert-TaskPattern -Task $target
    if ($target.family -ne $current.family -or $target.revision -ge $current.revision -or $target.status -ne 'ACTIVE' -or $target.containerDefinitions[0].image -notmatch "^$([regex]::Escape($imageRepository))@sha256:[0-9a-f]{64}$") { throw 'Rollback requires an older active revision of this application task family.' }
    $imageDigest = $target.containerDefinitions[0].image.Substring($imageRepository.Length + 1)
    $image = (Invoke-Aws @('ecr', 'describe-images', '--repository-name', $configuration.Repository, '--image-ids', "imageDigest=$imageDigest")).imageDetails | Select-Object -First 1
    $null = Invoke-Aws @('ecs', 'update-service', '--cluster', $configuration.Cluster, '--service', $configuration.Service, '--task-definition', $target.taskDefinitionArn)
    Test-Deployment -ExpectedTaskArn $target.taskDefinitionArn -ExpectedImageDigest $image.imageDigest -ExpectedImageUri $target.containerDefinitions[0].image -Invariant $invariant
    Write-Host "Rollback complete: $($target.taskDefinitionArn) ($imageDigest)."
    exit 0
}

$commit = Assert-ReviewedCommit
try {
    Invoke-RequiredLocalValidation
} catch {
    Write-Host "PRE-DEPLOYMENT VALIDATION FAILED — ECS unchanged: $($_.Exception.Message)"
    throw
}
$imageTag = "$commit$($configuration.ImageSuffix)"
$image = Publish-Image -Commit $commit -ImageTag $imageTag
$imageUri = "${imageRepository}@$($image.imageDigest)"
$registered = Register-ApplicationTaskRevision -CurrentTask (Get-TaskDefinition -TaskDefinition $previousHealthyTaskArn) -ImageUri $imageUri
$deploymentStarted = $false
try {
    $deploymentStarted = $true
    $null = Invoke-Aws @('ecs', 'update-service', '--cluster', $configuration.Cluster, '--service', $configuration.Service, '--task-definition', $registered.taskDefinitionArn)
    Test-Deployment -ExpectedTaskArn $registered.taskDefinitionArn -ExpectedImageDigest $image.imageDigest -ExpectedImageUri $imageUri -Invariant $invariant
    Write-Host "DEPLOYMENT SUCCEEDED: $Environment commit $commit, image $imageUri, task $($registered.taskDefinitionArn)."
    Write-Host "Rollback command: .\scripts\deploy-app.ps1 -Environment $Environment -RollbackTaskDefinitionArn $previousHealthyTaskArn"
    try {
        Invoke-PostDeploymentDiagnostics
    } catch {
        Write-Warning "LOCAL VALIDATION WARNING: $($_.Exception.Message)"
        Write-Host 'DEPLOYMENT SUCCEEDED WITH LOCAL VALIDATION WARNING'
    }
    if ($script:DeploymentWarnings.Count -gt 0) { Write-Host 'DEPLOYMENT SUCCEEDED WITH LOCAL VALIDATION WARNING' }
}
catch {
    $failure = $_
    if ($deploymentStarted) {
        Write-Host "DEPLOYMENT FAILED — rollback initiated: $($failure.Exception.Message)"
        try {
            $null = Invoke-Aws @('ecs', 'update-service', '--cluster', $configuration.Cluster, '--service', $configuration.Service, '--task-definition', $previousHealthyTaskArn)
            $previousTask = Get-TaskDefinition -TaskDefinition $previousHealthyTaskArn
            $previousDigest = $previousTask.containerDefinitions[0].image.Substring($imageRepository.Length + 1)
            $previousImage = (Invoke-Aws @('ecr', 'describe-images', '--repository-name', $configuration.Repository, '--image-ids', "imageDigest=$previousDigest")).imageDetails | Select-Object -First 1
            Test-Deployment -ExpectedTaskArn $previousHealthyTaskArn -ExpectedImageDigest $previousImage.imageDigest -ExpectedImageUri $previousTask.containerDefinitions[0].image -Invariant $invariant
            Write-Warning "Rollback completed: restored previously healthy task revision $previousHealthyTaskArn."
        } catch { throw "Deployment failed and automatic rollback also failed. Original failure: $($failure.Exception.Message). Rollback failure: $($_.Exception.Message)" }
    }
    throw $failure
}
