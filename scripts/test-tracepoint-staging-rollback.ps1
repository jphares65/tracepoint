Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:RollbackHelper = Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1'
$script:RollbackTarget = 'arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:9'
$script:RollbackCurrent = 'arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:10'
$script:RollbackImageDigest = 'sha256:' + ('0' * 64)
$script:RollbackImageTag = ('b' * 40) + '-aws-native-staging'
$script:RollbackImage = '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:' + $script:RollbackImageTag
$script:RollbackTemp = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-rollback-helper-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:RollbackTemp | Out-Null
$script:RollbackExecutable = Join-Path $script:RollbackTemp 'invoke-tracepoint-staging-rollback.ps1'
Copy-Item -LiteralPath $script:RollbackHelper -Destination $script:RollbackExecutable
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Destination $script:RollbackTemp
@'
param([int]$WaitSeconds)
$global:RollbackTestRuntimeCalls++
if ($WaitSeconds -ne 600) { throw 'Unexpected mocked health wait.' }
'@ | Set-Content -LiteralPath (Join-Path $script:RollbackTemp 'test-tracepoint-staging-runtime.ps1')
$global:RollbackTestScenario = 'read_only'
$global:RollbackTestTarget = $script:RollbackTarget
$global:RollbackTestImageDigest = $script:RollbackImageDigest
$global:RollbackTestServiceReads = 0
$global:RollbackTestRuntimeCalls = 0
$global:RollbackTestUpdated = $false
$global:RollbackTestImage = ''
$global:RollbackTestScanTags = @()
$global:RollbackTestCalls = @()
function global:aws.exe {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    $global:RollbackTestCalls += $command
    if ($command -like 'sts get-caller-identity*') {
        return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}'
    }
    if ($command -like 'ecs describe-services*') {
        $global:RollbackTestServiceReads++
        $servingArn = 'arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:10'
        $runningCount = 1
        if ($global:RollbackTestUpdated -and $global:RollbackTestScenario -ne 'fallback') { $servingArn = 'arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:9' }
        if ($global:RollbackTestUpdated -and $global:RollbackTestScenario -eq 'unhealthy') { $runningCount = 0 }
        return (@{ services = @(@{ taskDefinition = $servingArn; desiredCount = 1; runningCount = $runningCount; pendingCount = 0; deployments = @(@{ rolloutState = 'COMPLETED' }) }) } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'ecs describe-task-definition*') {
        if ($command -match 'synthetic:10') { $revision = 10; $taskImage = '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:' + ('a' * 40) } else { $revision = 9; $taskImage = $global:RollbackTestImage }
        return (@{ taskDefinition = @{ family = 'tracepoint-staging'; revision = $revision; status = 'ACTIVE'; containerDefinitions = @(@{ name = 'tracepoint'; image = $taskImage }) } } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'ecr describe-image-scan-findings*') {
        if ($command -match 'imageTag=([^ ]+)') { $global:RollbackTestScanTags += $Matches[1] }
        return (@{ imageScanStatus = @{ status = 'COMPLETE' }; imageScanFindings = @{ findingSeverityCounts = @{} }; imageId = @{ imageDigest = $global:RollbackTestImageDigest } } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'ecs update-service*') {
        if ($global:RollbackTestScenario -eq 'update_error') { $global:LASTEXITCODE = 1; return '{}' }
        $global:RollbackTestUpdated = $true
        return '{"service":{}}'
    }
    if ($command -like 'ecs wait*') {
        if ($global:RollbackTestScenario -eq 'wait_error') { $global:LASTEXITCODE = 1 }
        return
    }
    if ($command -like 'ecs list-tasks*') { return '{"taskArns":["arn:aws:ecs:us-east-1:559054714699:task/tracepoint-staging/mock"]}' }
    if ($command -like 'ecs describe-tasks*') {
        $digest = $global:RollbackTestImageDigest
        if ($global:RollbackTestScenario -eq 'digest_mismatch') { $digest = 'sha256:' + ('1' * 64) }
        return (@{ failures = @(); tasks = @(@{ lastStatus = 'RUNNING'; taskDefinitionArn = $global:RollbackTestTarget; containers = @(@{ name = 'tracepoint'; image = $global:RollbackTestImage; imageDigest = $digest }) }) } | ConvertTo-Json -Depth 8 -Compress)
    }
    throw 'Unexpected AWS call in local rollback contract test.'
}

$savedRegion = $env:AWS_REGION
$savedDefaultRegion = $env:AWS_DEFAULT_REGION
try {
    $valid = @(
        @{ label = 'historical bare SHA'; sha = 'a' * 40; suffix = '' },
        @{ label = 'current staging image tag'; sha = 'b' * 40; suffix = '-aws-native-staging' }
    )
    foreach ($case in $valid) {
        $tag = $case.sha + $case.suffix
        $global:RollbackTestImage = '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:' + $tag
        $global:RollbackTestScanTags = @()
        $global:RollbackTestCalls = @()
        & $script:RollbackHelper -TaskDefinitionArn $script:RollbackTarget
        if ($global:RollbackTestScanTags.Count -ne 1 -or $global:RollbackTestScanTags[0] -cne $tag) { throw "Valid $($case.label) was not scanned under its exact immutable tag." }
        if ($global:RollbackTestCalls -match 'ecs update-service') { throw 'Read-only test unexpectedly updated the ECS service.' }
    }

    $unsafe = @(
        '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:latest',
        '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:' + ('C' * 40),
        '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:' + ('c' * 40) + '-aws-native-production',
        '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:' + ('d' * 40) + '-aws-native-staging-extra',
        '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production:' + ('e' * 40) + '-aws-native-staging',
        '999999999999.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:' + ('f' * 40) + '-aws-native-staging',
        '559054714699.dkr.ecr.us-west-2.amazonaws.com/tracepoint-staging:' + ('1' * 40) + '-aws-native-staging'
    )
    foreach ($image in $unsafe) {
        $global:RollbackTestImage = $image
        $global:RollbackTestScanTags = @()
        $global:RollbackTestCalls = @()
        $rejected = $false
        $rejectionMessage = $null
        try { & $script:RollbackHelper -TaskDefinitionArn $script:RollbackTarget } catch { $rejected = $true; $rejectionMessage = $_.Exception.Message }
        if (-not $rejected) { throw 'An unsafe image reference passed rollback validation.' }
        if ($rejectionMessage -ne 'Rollback image must use an immutable staging commit tag.') { throw 'Unsafe reference was rejected for a reason other than the image tag contract.' }
        if ($global:RollbackTestScanTags.Count -ne 0) { throw 'An unsafe image reached the ECR scan query.' }
        if (@($global:RollbackTestCalls | Where-Object { $_ -like 'ecs describe-task-definition*' }).Count -ne 2) { throw 'Unsafe reference was rejected before the task definition had been inspected.' }
    }
    $executeCases = @(
        @{ name = 'intended revision'; expectedError = $null },
        @{ name = 'fallback to prior revision'; scenario = 'fallback'; expectedError = 'Rollback stabilized on an unexpected task definition.' },
        @{ name = 'unhealthy service'; scenario = 'unhealthy'; expectedError = 'Requested rollback service is not healthy and stable.' },
        @{ name = 'update error'; scenario = 'update_error'; expectedError = 'Rollback metadata query failed.' },
        @{ name = 'wait error'; scenario = 'wait_error'; expectedError = 'Rollback failed to stabilize.' },
        @{ name = 'image digest mismatch'; scenario = 'digest_mismatch'; expectedError = 'Running rollback image does not match the scanned image digest.' }
    )
    foreach ($case in $executeCases) {
        $global:RollbackTestScenario = if ($case.ContainsKey('scenario')) { $case['scenario'] } else { 'execute_success' }
        $global:RollbackTestImage = $script:RollbackImage
        $global:RollbackTestScanTags = @()
        $global:RollbackTestCalls = @()
        $global:RollbackTestServiceReads = 0
        $global:RollbackTestRuntimeCalls = 0
        $global:RollbackTestUpdated = $false
        $executionError = $null
        try { & $script:RollbackExecutable -TaskDefinitionArn $script:RollbackTarget -Execute } catch { $executionError = $_.Exception.Message }
        if ($null -eq $case.expectedError) {
            if ($executionError) { throw "Execute path rejected the intended revision: $executionError" }
            if ($global:RollbackTestServiceReads -ne 3 -or $global:RollbackTestRuntimeCalls -ne 1) { throw 'Successful execute path did not verify the requested revision after stabilization and health checks.' }
            if (-not ($global:RollbackTestCalls -match 'ecs update-service') -or -not ($global:RollbackTestCalls -match 'ecs wait services-stable') -or -not ($global:RollbackTestCalls -match 'ecs describe-tasks')) { throw 'Successful execute path skipped an expected mocked ECS operation.' }
        } else {
            if ($executionError -cne $case.expectedError) { throw "Execute path failed the $($case.name) case with an unexpected result." }
            if ($global:RollbackTestRuntimeCalls -ne 0) { throw "Health validation ran after the $($case.name) failure." }
        }
        if ($global:RollbackTestCalls -match 'ecs update-service' -and $global:RollbackTestScenario -in @('fallback','unhealthy','update_error','wait_error','digest_mismatch')) {
            if ($global:RollbackTestScenario -eq 'update_error' -and $global:RollbackTestUpdated) { throw 'Injected update failure still mutated the mock service.' }
        }
    }
    Write-Host 'Passed rollback helper checks: two valid tags, seven unsafe references, intended Execute revision, wrong-revision fallback, unhealthy service, update/wait errors, and digest mismatch. All AWS calls were mocked.'
    $global:LASTEXITCODE = 0
} finally {
    Remove-Item Function:/aws.exe -ErrorAction SilentlyContinue
    $resolvedTemp = [IO.Path]::GetFullPath($script:RollbackTemp)
    if ([IO.Path]::GetDirectoryName($resolvedTemp).TrimEnd('\') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolvedTemp) -notlike 'tracepoint-rollback-helper-test-*') { throw 'Rollback test cleanup boundary failed.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    if ($null -eq $savedRegion) { Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue } else { $env:AWS_REGION = $savedRegion }
    if ($null -eq $savedDefaultRegion) { Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue } else { $env:AWS_DEFAULT_REGION = $savedDefaultRegion }
}
