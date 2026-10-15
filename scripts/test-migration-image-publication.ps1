Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourcePath = Join-Path $PSScriptRoot 'apply-app-migrations.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Migration publisher parser errors: $($parseErrors -join '; ')" }
$requiredFunctionNames = @('Test-EcrImageNotFoundError', 'Publish-MigrationImage')
$functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $requiredFunctionNames }, $true))
foreach ($name in $requiredFunctionNames) {
    if (-not ($functions | Where-Object Name -eq $name)) { throw "Migration publisher function '$name' was not found." }
}
foreach ($function in $functions) { . ([scriptblock]::Create($function.Extent.Text)) }

$Environment = 'staging'
$settings = @{ Account='559054714699'; Repository='tracepoint-staging'; Bucket='synthetic-bucket'; Key='source.zip'; Build='synthetic-build'; Region='us-east-1' }
$root = $repositoryRoot
$global:MigrationImageScenario = $null
$global:MigrationImageBuildCount = 0
$global:MigrationImageBuildStarted = $false

function Invoke-Aws {
    param([string[]]$Arguments)
    $joined = $Arguments -join ' '
    if ($Arguments[0] -eq 'ecr' -and $Arguments[1] -eq 'describe-images') {
        if ($global:MigrationImageBuildStarted) { return @{ imageDetails=@(@{imageDigest='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}) } }
        switch ($global:MigrationImageScenario) {
            'not-found' { throw 'AWS command failed: An error occurred (ImageNotFoundException) when calling the DescribeImages operation: Image not found.' }
            'access-denied' { throw 'AWS command failed: An error occurred (AccessDeniedException) when calling the DescribeImages operation: denied.' }
            'network' { throw 'AWS command failed: Could not connect to the endpoint URL: https://ecr.us-east-1.amazonaws.com/' }
            'unknown' { throw 'AWS command failed: An error occurred (InternalFailure) when calling the DescribeImages operation: service error.' }
        }
    }
    if ($Arguments[0] -eq 's3api' -and $Arguments[1] -eq 'put-object') { return @{ VersionId='synthetic-version' } }
    if ($Arguments[0] -eq 'codebuild' -and $Arguments[1] -eq 'start-build') {
        $global:MigrationImageBuildCount++
        $global:MigrationImageBuildStarted = $true
        return @{ build=@{ id='synthetic-build-id' } }
    }
    if ($Arguments[0] -eq 'codebuild' -and $Arguments[1] -eq 'batch-get-builds') { return @{ builds=@(@{ buildStatus='SUCCEEDED' }) } }
    throw "Unexpected mocked publisher call: $joined"
}
function git.exe {
    $global:LASTEXITCODE = 0
    $joined = $args -join ' '
    if ($joined -match 'diff --name-only') { return 'scripts/run-aws-native-migrations.mjs' }
}
function Start-Sleep { param([int]$Seconds) }

foreach ($scenario in @('access-denied', 'network', 'unknown')) {
    $global:MigrationImageScenario = $scenario
    $global:MigrationImageBuildCount = 0
    $global:MigrationImageBuildStarted = $false
    $failed = $false
    try { $null = Publish-MigrationImage -Commit ('a' * 40) } catch { $failed = $true }
    if (-not $failed) { throw "Migration publisher accepted the $scenario ECR lookup failure." }
    if ($global:MigrationImageBuildCount -ne 0) { throw "Migration publisher started a build after $scenario." }
}

$global:MigrationImageScenario = 'not-found'
$global:MigrationImageBuildCount = 0
$global:MigrationImageBuildStarted = $false
$published = Publish-MigrationImage -Commit ('a' * 40)
if ($global:MigrationImageBuildCount -ne 1 -or $published.Tag -ne 'migration-' + ('a' * 40) + '-aws-native-staging' -or $published.Digest -notmatch '^sha256:[0-9a-f]{64}$') {
    throw 'A genuine ImageNotFoundException must allow exactly one image build and return its immutable digest.'
}

Write-Host 'Migration image publisher behavioral tests passed: access denied, network, and unknown errors started zero builds; ImageNotFoundException started one mocked build. No AWS calls.'
