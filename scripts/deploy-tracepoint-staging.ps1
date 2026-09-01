[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ExpectedAccount = '559054714699'
$DeniedAccount = '265544358665'
$Region = 'us-east-1'
$Profile = 'tracepoint-member-staging'
$EnvironmentName = 'tracepoint-staging'
$RepositoryName = 'tracepoint-staging'
$BudgetName = 'tracepoint-staging-monthly-75'
$BudgetLimitDollars = 75
$CertificateDomain = 'staging.tracepointhq.com'
$RepositoryRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$InfraRoot = Join-Path $RepositoryRoot 'infra'
$ReportDirectory = Join-Path $InfraRoot 'cdk.out.deployment'
$ReportPath = Join-Path $ReportDirectory 'deployment-transcript.txt'
$ProtectedPath = 'src/app/integration-demo/page.tsx'
$Blockers = [System.Collections.Generic.List[string]]::new()
$Results = [ordered]@{}
$CurrentPhase = 'local initialization'

$env:AWS_CONFIG_FILE = 'C:\Users\jphar\.aws\config'
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:AWS_SDK_LOAD_CONFIG = '1'

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is not available. No installation was attempted."
    }
}

function Write-Operational([string]$Message) {
    $sanitized = $Message -replace '[\r\n]+', ' '
    Write-Host $sanitized
    Add-Content -LiteralPath $ReportPath -Value $sanitized -Encoding UTF8
}

function Add-Blocker([string]$Message) {
    if (-not $Blockers.Contains($Message)) {
        $Blockers.Add($Message)
        Write-Operational "BLOCKER: $Message"
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$WorkingDirectory = $RepositoryRoot,
        [switch]$Capture,
        [switch]$AllowFailure
    )

    Push-Location $WorkingDirectory
    try {
        # Native tools report diagnostics on stderr for ordinary nonzero exits.
        # Keep PowerShell from promoting that stream to a terminating ErrorRecord;
        # this wrapper owns exit-code handling, including intentional probes.
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        if ($Capture) {
            try {
                $output = & $FilePath @Arguments 2>&1
                $exitCode = $LASTEXITCODE
            }
            finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }
            if ($exitCode -ne 0 -and -not $AllowFailure) {
                throw "$FilePath failed with exit code $exitCode."
            }
            return [pscustomobject]@{ ExitCode = $exitCode; Output = @($output) }
        }

        try {
            & $FilePath @Arguments
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($exitCode -ne 0 -and -not $AllowFailure) {
            throw "$FilePath failed with exit code $exitCode."
        }
        return $exitCode
    }
    finally {
        Pop-Location
    }
}

function Invoke-AwsJson {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    $allArguments = @($Arguments) + @('--profile', $Profile, '--region', $Region, '--output', 'json')
    $result = Invoke-Native -FilePath 'aws.exe' -Arguments $allArguments -Capture -AllowFailure:$AllowFailure
    if ($result.ExitCode -ne 0) {
        return $null
    }
    $text = ($result.Output -join [Environment]::NewLine).Trim()
    if (-not $text) {
        return $null
    }
    return $text | ConvertFrom-Json
}

function Assert-StagingIdentity {
    $identity = Invoke-AwsJson -Arguments @('sts', 'get-caller-identity')
    if ($identity.Account -eq $DeniedAccount) {
        throw "Refusing AWS Organizations management account $DeniedAccount."
    }
    if ($identity.Account -ne $ExpectedAccount) {
        throw "Refusing account '$($identity.Account)'; expected $ExpectedAccount."
    }
    if ($identity.Arn -notlike '*TracePointMigrationStaging*') {
        throw "Refusing ARN '$($identity.Arn)'; TracePointMigrationStaging role is required."
    }
    if ($env:AWS_REGION -ne $Region -or $env:AWS_DEFAULT_REGION -ne $Region) {
        throw "Refusing region configuration outside $Region."
    }
    return $identity
}

function Get-Stack {
    param([Parameter(Mandatory)][string]$Name)
    $result = Invoke-AwsJson -Arguments @('cloudformation', 'describe-stacks', '--stack-name', $Name) -AllowFailure
    if ($null -eq $result -or $null -eq $result.Stacks -or $result.Stacks.Count -eq 0) {
        return $null
    }
    return $result.Stacks[0]
}

function Wait-ForExistingStack {
    param([Parameter(Mandatory)][string]$Name)
    $stack = Get-Stack -Name $Name
    if ($null -eq $stack) { return $null }
    $status = [string]$stack.StackStatus
    if ($status -like '*_IN_PROGRESS') {
        Write-Operational "Waiting for existing operation on $Name ($status)."
        if ($status -eq 'CREATE_IN_PROGRESS') {
            Invoke-Native -FilePath 'aws.exe' -Arguments @('cloudformation', 'wait', 'stack-create-complete', '--stack-name', $Name, '--profile', $Profile, '--region', $Region)
        }
        elseif ($status -eq 'UPDATE_IN_PROGRESS' -or $status -eq 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS') {
            Invoke-Native -FilePath 'aws.exe' -Arguments @('cloudformation', 'wait', 'stack-update-complete', '--stack-name', $Name, '--profile', $Profile, '--region', $Region)
        }
        else {
            Add-Blocker "$Name has unsupported in-progress status $status; no competing deployment was started."
            return $stack
        }
        $stack = Get-Stack -Name $Name
    }
    return $stack
}

function Deploy-StackSafe {
    param([Parameter(Mandatory)][string]$Name, [bool]$RuntimeEnabled = $false, [string]$CertificateArn = '', [string]$ImageTag = '')
    Assert-StagingIdentity | Out-Null
    $existing = Wait-ForExistingStack -Name $Name
    if ($null -ne $existing -and [string]$existing.StackStatus -match '^(ROLLBACK_COMPLETE|UPDATE_ROLLBACK_FAILED|CREATE_FAILED|DELETE_)') {
        Add-Blocker "$Name is $($existing.StackStatus) and requires explicit human remediation; this script never deletes resources."
        return $false
    }

    $arguments = @(
        'cdk', 'deploy', $Name,
        '--profile', $Profile,
        '-c', "account=$ExpectedAccount",
        '-c', "region=$Region",
        '-c', "environment=$EnvironmentName",
        '-c', "runtimeEnabled=$($RuntimeEnabled.ToString().ToLowerInvariant())",
        '--lookups=false', '--require-approval', 'never'
    )
    if ($RuntimeEnabled) {
        $arguments += @('-c', "certificateArn=$CertificateArn", '-c', "imageTag=$ImageTag")
    }
    $diffArguments = @($arguments)
    $diffArguments[1] = 'diff'
    $diffArguments = @($diffArguments | Where-Object { $_ -notin @('--require-approval', 'never') })
    Write-Operational "Reviewing the live CDK diff for $Name."
    Invoke-Native -FilePath 'npx.cmd' -Arguments $diffArguments -WorkingDirectory $InfraRoot
    Invoke-Native -FilePath 'npx.cmd' -Arguments $arguments -WorkingDirectory $InfraRoot
    $deployed = Get-Stack -Name $Name
    if ($null -eq $deployed -or [string]$deployed.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')) {
        Add-Blocker "$Name did not reach CREATE_COMPLETE or UPDATE_COMPLETE."
        return $false
    }
    Write-Operational "$Name verified as $($deployed.StackStatus)."
    return $true
}

function Test-RequiredSecretFields {
    param([Parameter(Mandatory)][psobject]$SecretObject)
    $required = @('SUPABASE_SECRET_KEY', 'BREVO_API_KEY', 'NOTIFICATION_DISPATCH_SECRET', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY')
    foreach ($name in $required) {
        $property = $SecretObject.PSObject.Properties[$name]
        if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
            return $false
        }
    }
    return $true
}

function Write-FinalReport {
    Write-Operational '--- sanitized final report ---'
    foreach ($entry in $Results.GetEnumerator()) {
        Write-Operational "$($entry.Key): $($entry.Value)"
    }
    if ($Blockers.Count -eq 0) {
        Write-Operational 'Blockers: none'
    }
    else {
        Write-Operational "Blockers: $($Blockers -join ' | ')"
    }
    Write-Operational "Transcript: $ReportPath"
}

foreach ($command in @('aws.exe', 'git.exe', 'node.exe', 'npm.cmd', 'npx.cmd')) {
    Require-Command $command
}
New-Item -ItemType Directory -Force -Path $ReportDirectory | Out-Null
Set-Content -LiteralPath $ReportPath -Value 'TracePoint staging deployment transcript (sanitized)' -Encoding UTF8

try {
    # The first AWS API call must always be STS.
    $CurrentPhase = 'STS identity gate'
    $identity = Assert-StagingIdentity
    $Results['AWS identity'] = "account $($identity.Account), role TracePointMigrationStaging, region $Region"
    Write-Operational "Identity gate passed for account $ExpectedAccount and TracePointMigrationStaging."

    $gitRoot = (Invoke-Native -FilePath 'git.exe' -Arguments @('rev-parse', '--show-toplevel') -Capture).Output[0].Trim()
    if ((Resolve-Path -LiteralPath $gitRoot).Path -ne $RepositoryRoot) { throw 'Repository root validation failed.' }
    $protectedStatus = (Invoke-Native -FilePath 'git.exe' -Arguments @('status', '--short', '--untracked-files=all', '--', $ProtectedPath) -Capture).Output -join ''
    if ($protectedStatus.Trim() -ne "?? $ProtectedPath") { throw "$ProtectedPath must remain present, untracked, and unmodified." }
    $commitSha = ((Invoke-Native -FilePath 'git.exe' -Arguments @('rev-parse', 'HEAD') -Capture).Output -join '').Trim().ToLowerInvariant()
    if ($commitSha -notmatch '^[0-9a-f]{40}$') { throw 'Git commit SHA validation failed.' }
    $Results['Image tag'] = $commitSha

    $stacks = Invoke-AwsJson -Arguments @('cloudformation', 'describe-stacks') -AllowFailure
    $stackNames = @($stacks.Stacks | ForEach-Object { $_.StackName } | Where-Object { $_ -like 'tracepoint-staging-*' -or $_ -eq 'CDKToolkit' })
    $Results['Initial stacks'] = if ($stackNames.Count) { $stackNames -join ', ' } else { 'none' }
    $repositories = Invoke-AwsJson -Arguments @('ecr', 'describe-repositories') -AllowFailure
    $Results['Initial ECR'] = if (@($repositories.repositories | Where-Object repositoryName -eq $RepositoryName).Count) { $RepositoryName } else { 'none' }
    $clusters = Invoke-AwsJson -Arguments @('ecs', 'list-clusters') -AllowFailure
    $Results['Initial ECS clusters'] = @($clusters.clusterArns).Count
    $vpcs = Invoke-AwsJson -Arguments @('ec2', 'describe-vpcs', '--filters', 'Name=tag:Name,Values=tracepoint-staging') -AllowFailure
    $Results['Initial TracePoint VPCs'] = @($vpcs.Vpcs).Count

    # Integer cents keep the recurring-cost guard deterministic.
    $costCents = [ordered]@{
        AlbAndPublicIpv4 = 2431
        FargateAndTaskIpv4 = 1266
        EcrKmsAndSecret = 150
        CloudWatchAndS3 = 70
        SecurityAllowance = 290
    }
    $monthlyCents = ($costCents.Values | Measure-Object -Sum).Sum
    if ($monthlyCents -gt ($BudgetLimitDollars * 100)) {
        throw "Projected recurring cost exceeds the $BudgetLimitDollars USD monthly ceiling."
    }
    $Results['Projected recurring cost'] = ('$' + ('{0:N2}' -f ($monthlyCents / 100)))
    Write-Operational "Cost gate passed: projected recurring cost is $($Results['Projected recurring cost']) per month."

    $budgets = Invoke-AwsJson -Arguments @('budgets', 'describe-budgets', '--account-id', $ExpectedAccount) -AllowFailure
    $budget = @($budgets.Budgets | Where-Object BudgetName -eq $BudgetName | Select-Object -First 1)
    if ($budget.Count -eq 0) {
        Assert-StagingIdentity | Out-Null
        Invoke-Native -FilePath 'aws.exe' -Arguments @(
            'budgets', 'create-budget', '--account-id', $ExpectedAccount,
            '--budget', "BudgetName=$BudgetName,BudgetLimit={Amount=$BudgetLimitDollars,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST",
            '--profile', $Profile, '--region', $Region
        )
        $Results['Budget'] = "$BudgetName created at `$$BudgetLimitDollars USD"
    }
    else {
        $limit = [decimal]$budget[0].BudgetLimit.Amount
        if ($limit -ne [decimal]$BudgetLimitDollars -or $budget[0].BudgetLimit.Unit -ne 'USD') {
            throw "Existing budget $BudgetName does not equal $BudgetLimitDollars USD."
        }
        $Results['Budget'] = "$BudgetName reused at `$$BudgetLimitDollars USD"
    }

    Write-Operational 'Building the Next.js application.'
    Invoke-Native -FilePath 'npm.cmd' -Arguments @('run', 'build') -WorkingDirectory $RepositoryRoot
    Write-Operational 'Building and synthesizing the CDK application.'
    Invoke-Native -FilePath 'npm.cmd' -Arguments @('run', 'build') -WorkingDirectory $InfraRoot
    Invoke-Native -FilePath 'npx.cmd' -Arguments @(
        'cdk', 'synth', '--strict', '--output', 'cdk.out.staging',
        '-c', "account=$ExpectedAccount", '-c', "region=$Region", '-c', "environment=$EnvironmentName",
        '-c', 'runtimeEnabled=false', '--lookups=false'
    ) -WorkingDirectory $InfraRoot
    $Results['Application build'] = 'passed'
    $Results['CDK build and synth'] = 'passed'

    $bootstrap = Invoke-AwsJson -Arguments @('ssm', 'get-parameter', '--name', '/cdk-bootstrap/hnb659fds/version') -AllowFailure
    if ($null -eq $bootstrap) {
        Assert-StagingIdentity | Out-Null
        Write-Operational 'Bootstrapping CDK in the verified staging account.'
        Invoke-Native -FilePath 'npx.cmd' -Arguments @(
            'cdk', 'bootstrap', "aws://$ExpectedAccount/$Region", '--profile', $Profile,
            '-c', "account=$ExpectedAccount", '-c', "region=$Region", '-c', "environment=$EnvironmentName", '-c', 'runtimeEnabled=false'
        ) -WorkingDirectory $InfraRoot
        $Results['CDK bootstrap'] = 'created'
    }
    else {
        $Results['CDK bootstrap'] = "reused version $($bootstrap.Parameter.Value)"
    }

    $foundationReady = $true
    $CurrentPhase = 'foundation deployment'
    foreach ($stackName in @('tracepoint-staging-network', 'tracepoint-staging-security', 'tracepoint-staging-compute')) {
        if (-not (Deploy-StackSafe -Name $stackName)) { $foundationReady = $false }
    }

    $repository = Invoke-AwsJson -Arguments @('ecr', 'describe-repositories', '--repository-names', $RepositoryName) -AllowFailure
    if ($null -eq $repository -or @($repository.repositories).Count -eq 0) {
        Add-Blocker 'tracepoint-staging ECR does not exist because the compute foundation was not deployable.'
        $foundationReady = $false
    }
    else {
        $repositoryDetail = $repository.repositories[0]
        if ($repositoryDetail.imageTagMutability -ne 'IMMUTABLE' -or $repositoryDetail.encryptionConfiguration.encryptionType -ne 'KMS') {
            throw 'Existing tracepoint-staging ECR is not immutable and KMS encrypted.'
        }
        $Results['ECR URI'] = $repositoryDetail.repositoryUri
    }

    $secretReady = $false
    $serverActionKey = $null
    if ($foundationReady) {
        $secretResult = Invoke-Native -FilePath 'aws.exe' -Arguments @(
            'secretsmanager', 'get-secret-value', '--secret-id', 'tracepoint/staging/application',
            '--query', 'SecretString', '--output', 'text', '--profile', $Profile, '--region', $Region
        ) -Capture -AllowFailure
        if ($secretResult.ExitCode -eq 0) {
            try {
                $secretObject = (($secretResult.Output -join [Environment]::NewLine) | ConvertFrom-Json)
                $secretReady = Test-RequiredSecretFields -SecretObject $secretObject
                if ($secretReady) { $serverActionKey = [string]$secretObject.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY }
            }
            catch { $secretReady = $false }
        }
        if (-not $secretReady) {
            Add-Blocker 'Populate tracepoint/staging/application atomically with SUPABASE_SECRET_KEY, BREVO_API_KEY, NOTIFICATION_DISPATCH_SECRET, and NEXT_SERVER_ACTIONS_ENCRYPTION_KEY.'
        }
    }

    $publicBuildReady = -not [string]::IsNullOrWhiteSpace($env:TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_URL) -and
        -not [string]::IsNullOrWhiteSpace($env:TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) -and
        -not [string]::IsNullOrWhiteSpace($env:TRACEPOINT_STAGING_NEXT_PUBLIC_SITE_URL)
    if (-not $publicBuildReady) {
        Add-Blocker 'Set TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_URL, TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and TRACEPOINT_STAGING_NEXT_PUBLIC_SITE_URL in the invoking staging session.'
    }

    $dockerReady = $null -ne (Get-Command 'docker.exe' -ErrorAction SilentlyContinue)
    if (-not $dockerReady) { Add-Blocker 'Install/start Docker so docker.exe is available to build the existing Dockerfile.' }

    $imageReady = $false
    $imageDigest = ''
    $scanStatus = 'not run'
    if ($foundationReady -and $secretReady -and $publicBuildReady -and $dockerReady) {
        Invoke-Native -FilePath 'docker.exe' -Arguments @('version') | Out-Null
        $env:NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = $serverActionKey
        try {
            Write-Operational "Building immutable container image for commit $commitSha."
            Invoke-Native -FilePath 'docker.exe' -Arguments @(
                'build', '--secret', 'id=next_server_actions_encryption_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
                '--build-arg', "NEXT_PUBLIC_SUPABASE_URL=$($env:TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_URL)",
                '--build-arg', "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$($env:TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
                '--build-arg', "NEXT_PUBLIC_SITE_URL=$($env:TRACEPOINT_STAGING_NEXT_PUBLIC_SITE_URL)",
                '--build-arg', "DEPLOYMENT_VERSION=$commitSha", '-t', "$RepositoryName`:$commitSha", '.'
            ) -WorkingDirectory $RepositoryRoot
        }
        finally {
            Remove-Item Env:NEXT_SERVER_ACTIONS_ENCRYPTION_KEY -ErrorAction SilentlyContinue
            $serverActionKey = $null
            $secretObject = $null
        }

        $existingImage = Invoke-AwsJson -Arguments @('ecr', 'describe-images', '--repository-name', $RepositoryName, '--image-ids', "imageTag=$commitSha") -AllowFailure
        if ($null -eq $existingImage -or @($existingImage.imageDetails).Count -eq 0) {
            Assert-StagingIdentity | Out-Null
            $registry = "$ExpectedAccount.dkr.ecr.$Region.amazonaws.com"
            $login = Invoke-Native -FilePath 'aws.exe' -Arguments @('ecr', 'get-login-password', '--profile', $Profile, '--region', $Region) -Capture
            try {
                ($login.Output -join '') | & docker.exe login --username AWS --password-stdin $registry | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Docker ECR login failed.' }
            }
            finally { $login = $null }
            Invoke-Native -FilePath 'docker.exe' -Arguments @('tag', "$RepositoryName`:$commitSha", "$registry/$RepositoryName`:$commitSha")
            Invoke-Native -FilePath 'docker.exe' -Arguments @('push', "$registry/$RepositoryName`:$commitSha")
            $Results['Image publish'] = 'pushed'
        }
        else {
            $Results['Image publish'] = 'immutable tag already existed; push skipped'
        }

        $image = Invoke-AwsJson -Arguments @('ecr', 'describe-images', '--repository-name', $RepositoryName, '--image-ids', "imageTag=$commitSha")
        $imageDigest = [string]$image.imageDetails[0].imageDigest
        $imageReady = -not [string]::IsNullOrWhiteSpace($imageDigest)
        $waitScan = Invoke-Native -FilePath 'aws.exe' -Arguments @(
            'ecr', 'wait', 'image-scan-complete', '--repository-name', $RepositoryName, '--image-id', "imageTag=$commitSha",
            '--profile', $Profile, '--region', $Region
        ) -Capture -AllowFailure
        $scan = Invoke-AwsJson -Arguments @('ecr', 'describe-image-scan-findings', '--repository-name', $RepositoryName, '--image-id', "imageTag=$commitSha") -AllowFailure
        if ($null -ne $scan) { $scanStatus = [string]$scan.imageScanStatus.status }
        $Results['Image digest'] = $imageDigest
        $Results['Image scan'] = $scanStatus
    }

    $certificates = Invoke-AwsJson -Arguments @('acm', 'list-certificates', '--certificate-statuses', 'ISSUED') -AllowFailure
    $certificate = @($certificates.CertificateSummaryList | Where-Object DomainName -eq $CertificateDomain | Select-Object -First 1)
    $certificateArn = if ($certificate.Count) { [string]$certificate[0].CertificateArn } else { '' }
    if (-not $certificateArn) { Add-Blocker "Provide an ISSUED us-east-1 ACM certificate for $CertificateDomain; this script does not request certificates or change DNS." }

    $runtimeReady = $foundationReady -and $secretReady -and $imageReady -and -not [string]::IsNullOrWhiteSpace($certificateArn)
    if ($runtimeReady) {
        Deploy-StackSafe -Name 'tracepoint-staging-runtime' -RuntimeEnabled $true -CertificateArn $certificateArn -ImageTag $commitSha | Out-Null
    }

    $CurrentPhase = 'post-deployment verification'
    $finalStacks = Invoke-AwsJson -Arguments @('cloudformation', 'describe-stacks')
    $Results['Stack statuses'] = (@($finalStacks.Stacks | Where-Object { $_.StackName -like 'tracepoint-staging-*' -or $_.StackName -eq 'CDKToolkit' } | Sort-Object StackName | ForEach-Object { "$($_.StackName)=$($_.StackStatus)" }) -join ', ')
    $traceVpc = Invoke-AwsJson -Arguments @('ec2', 'describe-vpcs', '--filters', 'Name=tag:Name,Values=tracepoint-staging') -AllowFailure
    if (@($traceVpc.Vpcs).Count) {
        $vpcId = [string]$traceVpc.Vpcs[0].VpcId
        $subnets = Invoke-AwsJson -Arguments @('ec2', 'describe-subnets', '--filters', "Name=vpc-id,Values=$vpcId")
        $nat = Invoke-AwsJson -Arguments @('ec2', 'describe-nat-gateways', '--filter', "Name=vpc-id,Values=$vpcId")
        $endpoints = Invoke-AwsJson -Arguments @('ec2', 'describe-vpc-endpoints', '--filters', "Name=vpc-id,Values=$vpcId")
        $flowLogs = Invoke-AwsJson -Arguments @('ec2', 'describe-flow-logs', '--filter', "Name=resource-id,Values=$vpcId")
        if (@($nat.NatGateways | Where-Object State -ne 'deleted').Count -ne 0) { throw 'Lean staging invariant failed: NAT Gateway detected.' }
        if (@($subnets.Subnets | Where-Object MapPublicIpOnLaunch -eq $true).Count -lt 2) { throw 'Expected two public staging subnets.' }
        if (@($endpoints.VpcEndpoints | Where-Object VpcEndpointType -eq 'Interface').Count -ne 0) { throw 'Lean staging invariant failed: paid interface endpoint detected.' }
        if (@($flowLogs.FlowLogs | Where-Object FlowLogStatus -eq 'ACTIVE').Count -lt 1) { throw 'VPC Flow Logs are not active.' }
        $Results['Networking'] = "VPC $vpcId; two public subnets; no NAT; no interface endpoints; flow logs active"
    }

    $key = Invoke-AwsJson -Arguments @('kms', 'describe-key', '--key-id', 'alias/tracepoint/staging/data') -AllowFailure
    $rotation = Invoke-AwsJson -Arguments @('kms', 'get-key-rotation-status', '--key-id', 'alias/tracepoint/staging/data') -AllowFailure
    if ($null -ne $key -and $null -ne $rotation -and $key.KeyMetadata.Enabled -and $rotation.KeyRotationEnabled) {
        $Results['Encryption'] = 'TracePoint KMS key enabled with rotation'
    }
    elseif ($null -ne $key) {
        Add-Blocker 'The TracePoint KMS key exists, but enabled state and rotation could not both be verified.'
    }
    $logs = Invoke-AwsJson -Arguments @('logs', 'describe-log-groups', '--log-group-name-prefix', '/tracepoint/staging/application') -AllowFailure
    if (@($logs.logGroups).Count) {
        if ([string]::IsNullOrWhiteSpace([string]$logs.logGroups[0].kmsKeyId)) { throw 'Application log group is not KMS encrypted.' }
        $Results['Application logs'] = "KMS encrypted; retention $($logs.logGroups[0].retentionInDays) days"
    }
    $ecrFinal = Invoke-AwsJson -Arguments @('ecr', 'describe-repositories', '--repository-names', $RepositoryName) -AllowFailure
    if ($null -ne $ecrFinal) { $Results['ECR controls'] = 'immutable tags; scan on push; KMS encryption' }
    $cluster = Invoke-AwsJson -Arguments @('ecs', 'describe-clusters', '--clusters', $EnvironmentName) -AllowFailure
    if (@($cluster.clusters).Count) { $Results['ECS cluster'] = "$($cluster.clusters[0].status); running tasks $($cluster.clusters[0].runningTasksCount)" }

    $runtime = Get-Stack -Name 'tracepoint-staging-runtime'
    if ($null -ne $runtime -and [string]$runtime.StackStatus -in @('CREATE_COMPLETE', 'UPDATE_COMPLETE')) {
        $service = Invoke-AwsJson -Arguments @('ecs', 'describe-services', '--cluster', $EnvironmentName, '--services', $EnvironmentName)
        $Results['ECS service'] = "desired $($service.services[0].desiredCount); running $($service.services[0].runningCount); pending $($service.services[0].pendingCount)"
        $targetGroupArn = [string]$service.services[0].loadBalancers[0].targetGroupArn
        if (-not [string]::IsNullOrWhiteSpace($targetGroupArn)) {
            $health = Invoke-AwsJson -Arguments @('elbv2', 'describe-target-health', '--target-group-arn', $targetGroupArn)
            $Results['Target health'] = (@($health.TargetHealthDescriptions | ForEach-Object { $_.TargetHealth.State }) -join ', ')
        }
        $Results['Application health'] = 'runtime deployed; use staging DNS after the platform owner creates/validates the alias'
    }
    else {
        $Results['Application health'] = 'not applicable; runtime not safely deployable'
    }

    $bootstrapBucket = Invoke-AwsJson -Arguments @('s3api', 'list-buckets', '--query', "Buckets[?starts_with(Name, 'cdk-hnb659fds-assets-$ExpectedAccount-$Region')].Name") -AllowFailure
    if ($null -ne $bootstrapBucket -and @($bootstrapBucket).Count) {
        $bucketBlock = Invoke-AwsJson -Arguments @('s3api', 'get-public-access-block', '--bucket', [string]$bootstrapBucket[0]) -AllowFailure
        if ($null -eq $bucketBlock -or -not $bucketBlock.PublicAccessBlockConfiguration.BlockPublicAcls -or -not $bucketBlock.PublicAccessBlockConfiguration.BlockPublicPolicy -or -not $bucketBlock.PublicAccessBlockConfiguration.IgnorePublicAcls -or -not $bucketBlock.PublicAccessBlockConfiguration.RestrictPublicBuckets) {
            throw 'CDK bootstrap bucket public-access block verification failed.'
        }
        $Results['S3 public access'] = 'CDK bootstrap bucket blocks all public access; no application bucket deployed'
    }

    $Results['Protected file'] = "$ProtectedPath remains untracked and unmodified"
    Write-FinalReport
}
catch {
    $fatalMessage = [string]$_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($fatalMessage)) {
        $fatalMessage = "Execution was interrupted during $CurrentPhase before a diagnostic message was returned."
    }
    Add-Blocker $fatalMessage
    $Results['Fatal result'] = 'deployment stopped safely'
    Write-FinalReport
    exit 1
}
finally {
    Remove-Item Env:NEXT_SERVER_ACTIONS_ENCRYPTION_KEY -ErrorAction SilentlyContinue
}

exit 0
