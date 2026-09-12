[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][ValidateSet('setup','cleanup')][string]$Operation,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [Parameter(Mandatory)][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ToolingImageDigest,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$RunId,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$ManagerId,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$ManagerSubject,
    [Parameter(Mandatory)][ValidatePattern('^aws-native-[a-z0-9-]+@example\.invalid$')][string]$ManagerEmail,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$OfficerId,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$OfficerSubject,
    [Parameter(Mandatory)][ValidatePattern('^aws-native-[a-z0-9-]+@example\.invalid$')][string]$OfficerEmail,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$ForeignUserId,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$ForeignSubject,
    [Parameter(Mandatory)][ValidatePattern('^aws-native-[a-z0-9-]+@example\.invalid$')][string]$ForeignEmail,
    [Parameter(Mandatory)][ValidatePattern('^https://cognito-idp\.us-east-1\.amazonaws\.com/us-east-1_[A-Za-z0-9]+$')][string]$CognitoIssuer,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{7,159}$')][string]$AuthorizationReference,
    [switch]$Execute,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
$account = '559054714699'
$region = 'us-east-1'
$stackName = 'tracepoint-staging-database-bootstrap'
$clusterName = 'tracepoint-staging'

function Invoke-AwsJson {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & aws.exe @Arguments --region $region --output json 2>&1
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($exitCode -ne 0) { throw "AWS fixture request failed: $($Arguments[0..1] -join ' ')." }
    return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

Assert-TracePointStagingIdentity | Out-Null
$budget = Invoke-AwsJson @('budgets','describe-budget','--account-id',$account,'--budget-name','tracepoint-staging-monthly-125')
if ([decimal]$budget.Budget.BudgetLimit.Amount -ne 125 -or $budget.Budget.BudgetLimit.Unit -ne 'USD') { throw 'The exact 125 USD staging budget is required.' }
$stack = Invoke-AwsJson @('cloudformation','describe-stacks','--stack-name',$stackName)
if ($stack.Stacks[0].StackStatus -notin @('CREATE_COMPLETE','UPDATE_COMPLETE')) { throw 'The bounded database runner stack is unavailable.' }
$outputs = @{}
foreach ($output in @($stack.Stacks[0].Outputs)) { $outputs[$output.OutputKey] = $output.OutputValue }
$taskDefinitionArn = [string]$outputs.TaskDefinitionArn
$subnets = @([string]$outputs.PublicSubnetIds -split ',')
$securityGroup = [string]$outputs.RunnerSecurityGroupId
if ($taskDefinitionArn -notmatch "^arn:aws:ecs:$region`:$account`:task-definition/tracepoint-staging-database-bootstrap:" -or
    $subnets.Count -ne 2 -or @($subnets | Where-Object { $_ -notmatch '^subnet-[0-9a-f]+$' }).Count -ne 0 -or
    $securityGroup -notmatch '^sg-[0-9a-f]+$') { throw 'The fixture runner coordinates are outside the staging boundary.' }
$definition = Invoke-AwsJson @('ecs','describe-task-definition','--task-definition',$taskDefinitionArn)
$container = @($definition.taskDefinition.containerDefinitions)
if ($container.Count -ne 1 -or $container[0].name -ne 'bootstrap' -or $container[0].image -cne "$account.dkr.ecr.$region.amazonaws.com/tracepoint-staging@$ToolingImageDigest") {
    throw 'The fixture runner does not use the expected immutable PostgreSQL tooling image.'
}

$plan = [ordered]@{operation=$Operation;sourceCommit=$SourceCommit;toolingImageDigest=$ToolingImageDigest;runId=$RunId;account=$account;region=$region;taskDefinitionArn=$taskDefinitionArn;authorizationReference=$AuthorizationReference;syntheticOnly=$true;execute=[bool]$Execute;valuesPrinted=$false}
if (-not $Execute) { $plan | ConvertTo-Json -Compress; return }
if ($Operation -eq 'cleanup' -and $env:TRACEPOINT_STAGING_FIXTURE_CLEANUP_AUTHORIZATION -cne $AuthorizationReference) {
    throw 'Run-bound cleanup authorization is required.'
}
if ($NonInteractive) { $ConfirmPreference = 'None' }
if (-not $PSCmdlet.ShouldProcess("AWS-native staging fixture $RunId", "$Operation the exact synthetic fixture")) { return }

$environment = @(
    @{name='TRACEPOINT_ACCEPTANCE_OPERATION';value=$Operation},
    @{name='TRACEPOINT_ACCEPTANCE_RUN_ID';value=$RunId},
    @{name='TRACEPOINT_ACCEPTANCE_SOURCE_COMMIT';value=$SourceCommit},
    @{name='TRACEPOINT_ACCEPTANCE_AUTHORIZATION_REFERENCE';value=$AuthorizationReference},
    @{name='TRACEPOINT_ACCEPTANCE_COGNITO_ISSUER';value=$CognitoIssuer},
    @{name='TRACEPOINT_ACCEPTANCE_MANAGER_ID';value=$ManagerId},
    @{name='TRACEPOINT_ACCEPTANCE_MANAGER_SUBJECT';value=$ManagerSubject},
    @{name='TRACEPOINT_ACCEPTANCE_MANAGER_EMAIL';value=$ManagerEmail},
    @{name='TRACEPOINT_ACCEPTANCE_OFFICER_ID';value=$OfficerId},
    @{name='TRACEPOINT_ACCEPTANCE_OFFICER_SUBJECT';value=$OfficerSubject},
    @{name='TRACEPOINT_ACCEPTANCE_OFFICER_EMAIL';value=$OfficerEmail},
    @{name='TRACEPOINT_ACCEPTANCE_FOREIGN_USER_ID';value=$ForeignUserId},
    @{name='TRACEPOINT_ACCEPTANCE_FOREIGN_SUBJECT';value=$ForeignSubject},
    @{name='TRACEPOINT_ACCEPTANCE_FOREIGN_EMAIL';value=$ForeignEmail}
)
$overrides = @{containerOverrides=@(@{name='bootstrap';command=@('scripts/manage-aws-native-staging-fixture.mjs');environment=$environment})} | ConvertTo-Json -Depth 8 -Compress
$network = "awsvpcConfiguration={subnets=[$($subnets -join ',')],securityGroups=[$securityGroup],assignPublicIp=ENABLED}"
$overridesPath = Join-Path ([IO.Path]::GetTempPath()) ("tracepoint-staging-fixture-" + [guid]::NewGuid().ToString('N') + '.json')
try {
    [IO.File]::WriteAllText($overridesPath, $overrides, [Text.UTF8Encoding]::new($false))
    $overridesUri = 'file://' + $overridesPath.Replace('\', '/')
    $task = Invoke-AwsJson @('ecs','run-task','--cluster',$clusterName,'--task-definition',$taskDefinitionArn,'--launch-type','FARGATE','--count','1','--network-configuration',$network,'--overrides',$overridesUri)
} finally {
    if (Test-Path -LiteralPath $overridesPath) { Remove-Item -LiteralPath $overridesPath -Force }
}
if (@($task.failures).Count -ne 0 -or @($task.tasks).Count -ne 1) { throw 'The bounded fixture task did not start.' }
$taskArn = [string]$task.tasks[0].taskArn
& aws.exe ecs wait tasks-stopped --cluster $clusterName --tasks $taskArn --region $region
if ($LASTEXITCODE -ne 0) { throw 'The bounded fixture task did not stop in time.' }
$stopped = Invoke-AwsJson @('ecs','describe-tasks','--cluster',$clusterName,'--tasks',$taskArn)
$resultContainer = @($stopped.tasks[0].containers | Where-Object name -eq 'bootstrap')
if ($resultContainer.Count -ne 1 -or $resultContainer[0].exitCode -ne 0) { throw 'The AWS-native staging fixture task failed; inspect only its sanitized log stream.' }
$taskId = ($taskArn -split '/')[-1]
$evidenceDeadline = [DateTime]::UtcNow.AddMinutes(2)
do {
    $messages = Invoke-AwsJson @('logs','get-log-events','--log-group-name','/tracepoint/staging/application','--log-stream-name',"database-bootstrap/bootstrap/$taskId",'--query','events[].message')
    $result = @($messages | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_.status -eq 'PASSED' -and $_.operation -eq $Operation -and $_.runId -eq $RunId })
    if ($result.Count -eq 1) { break }
    if ([DateTime]::UtcNow -ge $evidenceDeadline) { break }
    Start-Sleep -Seconds 2
} while ($true)
if ($result.Count -ne 1 -or $result[0].sourceCommit -ne $SourceCommit -or $result[0].sourceMigrations -ne 76 -or $result[0].awsMigrations -ne 19 -or $result[0].users -ne 3 -or $result[0].departments -ne 2 -or $result[0].syntheticOnly -ne $true) {
    throw 'The fixture task did not emit exact sanitized evidence.'
}
$plan['taskArn']=$taskArn
$plan['status']='PASSED'
$plan | ConvertTo-Json -Compress
