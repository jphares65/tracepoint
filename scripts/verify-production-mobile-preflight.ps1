[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DatabaseInstanceIdentifier,
    [Parameter(Mandatory)][string]$BackupVaultName,
    [Parameter(Mandatory)][string]$InspectionAuthorizationReference,
    [Parameter(Mandatory)][string]$InspectionNetworkAuthorizationReference,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string[]]$InspectionSubnetIds,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string[]]$InspectionSecurityGroupIds,
    [Parameter(Mandatory)][ValidateSet('ENABLED','DISABLED')][string]$InspectionAssignPublicIp,
    [Parameter(Mandatory)][ValidatePattern('^arn:aws:iam::193644343389:role/[A-Za-z0-9+=,.@_-]+$')][string]$ExpectedExecutionRoleArn,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$InspectionImageSourceCommit,
    [Parameter(Mandatory)][switch]$AuthorizeOneOffInspection,
    [Parameter(Mandatory)][ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$InspectionImageDigest,
    [ValidateSet('Prerequisites','ReleaseReady')][string]$Phase = 'Prerequisites',
    [string]$ExpectedProductionMobileClientId,
    [ValidateRange(1,9999)][int]$ExpectedTaskRevision = 23,
    [ValidatePattern('^sha256:[0-9a-f]{64}$')][string]$ExpectedProductionImageDigest = 'sha256:ca6792010bfcf301286932cbcfe225783ed54f829f81f0c39f0572547385e514'
)

# Read-only production release gate. Database inspection uses a separately
# launched, task-role-free Fargate task and an explicit read-only SQL action.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1) { throw 'Windows PowerShell 5.1 is required.' }
$profileName = 'tracepoint-production'
$region = 'us-east-1'
$account = '193644343389'
$expectedRole = 'TracePointMigrationProduction'
$poolId = 'us-east-1_diFmWDMe9'
$poolDomain = 'tracepoint-production-193644343389'
$expectedMfaConfiguration = 'ON'
$expectedProductionMobileCallbackUrl = 'tracepoint://auth'
$taskFamily = 'tracepoint-production-consolidated-aws-native-20260929'
$inspectionTaskFamilyPrefix = 'tracepoint-production-mobile-inspection'
$clusterName = 'tracepoint-production'
$serviceName = 'tracepoint-production'
$webClientName = 'tracepoint-production-web'
$requiredClientNames = @('tracepoint-production-web','tracepoint-phase3b-shadow','tracepoint-phase3c-rehearsal-only')
$productionApiRoutes = @(
    'src/app/api/mobile/session/route.ts',
    'src/app/api/mobile/equipment/assets/route.ts',
    'src/app/api/mobile/equipment/custody/route.ts',
    'src/app/api/mobile/readiness/equipment/route.ts',
    'src/app/api/mobile/fleet/vehicles/route.ts',
    'src/app/api/mobile/fleet/vehicles/[vehicleId]/route.ts',
    'src/app/api/mobile/fleet/vehicles/[vehicleId]/inspections/route.ts',
    'src/app/api/mobile/fleet/vehicles/[vehicleId]/inspections/[inspectionId]/evidence/route.ts',
    'src/app/api/mobile/attachments/[attachmentId]/download/route.ts',
    'src/app/api/mobile/qr/resolve/route.ts',
    'src/app/api/mobile/firearms/route.ts',
    'src/app/api/mobile/inventory/route.ts',
    'src/app/api/mobile/inbox/route.ts',
    'src/app/api/mobile/range-days/route.ts',
    'src/app/api/mobile/range-days/[rangeDayId]/route.ts',
    'src/app/api/mobile/range-days/[rangeDayId]/attendance/route.ts',
    'src/app/api/mobile/range-workspace/route.ts',
    'src/app/api/mobile/drill-documents/[documentId]/view/route.ts'
)
$script:Blockers = [System.Collections.Generic.List[string]]::new()
$script:Evidence = [ordered]@{ readOnly = $true; profile = $profileName; account = $account; region = $region; checks = [ordered]@{} }

function Invoke-AwsRead {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $allowed = @('sts get-caller-identity','ecs describe-services','ecs describe-task-definition','ecs list-task-definitions','ecs list-tasks','ecs describe-tasks','logs describe-log-streams','logs get-log-events','cognito-idp describe-user-pool','cognito-idp describe-user-pool-domain','cognito-idp list-user-pool-clients','cognito-idp describe-user-pool-client','rds describe-db-instances','ec2 describe-subnets','ec2 describe-security-groups','backup list-recovery-points-by-backup-vault','ecr describe-repositories','ecr describe-images','ecr describe-image-scan-findings')
    $verb = "$($Arguments[0]) $($Arguments[1])"
    if ($allowed -notcontains $verb) { throw "Read-only AWS command is not allow-listed: $verb" }
    $output = & aws.exe @Arguments --profile $profileName --region $region --output json --no-cli-pager 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Read-only AWS command failed: aws $verb (details suppressed)." }
    return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Invoke-AwsAuthorizedInspectionMutation {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $allowed = @('ecs register-task-definition','ecs run-task','ecs stop-task','ecs deregister-task-definition')
    $verb = "$($Arguments[0]) $($Arguments[1])"
    if ($allowed -notcontains $verb) { throw "One-off inspection AWS action is not allow-listed: $verb" }
    if (-not $AuthorizeOneOffInspection -or [string]::IsNullOrWhiteSpace($InspectionAuthorizationReference)) { throw 'Explicit authorization for the isolated one-off inspection task is required.' }
    $output = & aws.exe @Arguments --profile $profileName --region $region --output json --no-cli-pager 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Authorized one-off inspection action failed: aws $verb (details suppressed)." }
    return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Require-True {
    param([Parameter(Mandatory)][bool]$Value,[Parameter(Mandatory)][string]$Name)
    if (-not $Value) { throw "Production preflight gate failed: $Name" }
}

function Get-OptionalPropertyValue {
    param($Object,[Parameter(Mandatory)][string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Read-ReviewedProductionTarget {
    $targetPath = Join-Path $PSScriptRoot '..\infra\production-target-20260907.json'
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { throw 'Reviewed production target file is missing.' }
    try { $target = Get-Content -Raw -LiteralPath $targetPath | ConvertFrom-Json }
    catch { throw 'Reviewed production target file is invalid.' }
    if ($target.account -ne $account -or $target.roleArn -ne "arn:aws:iam::$account`:role/$expectedRole") { throw 'Reviewed production target account or role does not match the production gate.' }
    $approval = Get-OptionalPropertyValue $target 'inspectionAuthorization'
    if (-not $approval -or $approval.operation -ne 'mobile-preflight-inspection' -or $approval.account -ne $account -or $approval.roleArn -ne $target.roleArn -or [string]::IsNullOrWhiteSpace([string]$approval.reference)) { throw 'Reviewed production target has no operation-specific mobile inspection authorization.' }
    if ($InspectionAuthorizationReference -ne $approval.reference -or $env:TRACEPOINT_PRODUCTION_INSPECTION_AUTHORIZATION -ne $approval.reference) { throw 'Inspection approval reference must match the operation-specific authorization and TRACEPOINT_PRODUCTION_INSPECTION_AUTHORIZATION.' }
    $networkApproval = Get-OptionalPropertyValue $approval 'network'
    if (-not $networkApproval -or $networkApproval.connectivityVerified -ne $true -or [string]::IsNullOrWhiteSpace([string]$networkApproval.reference)) { throw 'The operation-specific inspection approval must include a connectivity-verified network authorization.' }
    if ($InspectionNetworkAuthorizationReference -ne $networkApproval.reference -or $env:TRACEPOINT_PRODUCTION_INSPECTION_NETWORK_AUTHORIZATION -ne $networkApproval.reference) { throw 'Network approval reference must match the operation-specific authorization and TRACEPOINT_PRODUCTION_INSPECTION_NETWORK_AUTHORIZATION.' }
    $approvedSubnets = @($networkApproval.subnetIds | Sort-Object -Unique)
    $requestedSubnets = @($InspectionSubnetIds | Sort-Object -Unique)
    $approvedSecurityGroups = @($networkApproval.securityGroupIds | Sort-Object -Unique)
    $requestedSecurityGroups = @($InspectionSecurityGroupIds | Sort-Object -Unique)
    if (($approvedSubnets -join ',') -ne ($requestedSubnets -join ',') -or ($approvedSecurityGroups -join ',') -ne ($requestedSecurityGroups -join ',') -or $networkApproval.assignPublicIp -ne $InspectionAssignPublicIp) { throw 'Inspection network inputs must exactly match the connectivity-verified operation approval.' }
    try { $expiresAt = [DateTimeOffset]::Parse([string]$approval.expiresAt).ToUniversalTime() }
    catch { throw 'Reviewed production authorization expiry is invalid.' }
    $now = [DateTimeOffset]::UtcNow
    if ($expiresAt -le $now -or $expiresAt -gt $now.AddHours(24)) { throw 'Production authorization must be unexpired and expire within 24 hours.' }
    if ([string]::IsNullOrWhiteSpace([string]$target.imageTag) -or $target.imageTag -notmatch '^[0-9a-f]{40}$') { throw 'Reviewed production target must pin the inspection image source commit.' }
    return $target
}

try {
    if (-not (Get-Command aws.exe -ErrorAction SilentlyContinue)) { throw 'AWS CLI v2 is required.' }
    if (-not $AuthorizeOneOffInspection) { throw 'Supply -AuthorizeOneOffInspection only after the one-off inspection has been explicitly approved.' }
    $productionTarget = Read-ReviewedProductionTarget
    $identity = Invoke-AwsRead @('sts','get-caller-identity')
    Require-True ($identity.Account -eq $account) 'AWS account must be 193644343389'
    Require-True ($identity.Arn -match "^arn:aws:sts::$account`:assumed-role/$expectedRole/[^/]+$") 'caller must assume TracePointMigrationProduction'
    $script:Evidence.checks.awsIdentity = @{ passed = $true; arn = $identity.Arn }

    $serviceResult = Invoke-AwsRead @('ecs','describe-services','--cluster',$clusterName,'--services',$serviceName)
    $service = @($serviceResult.services | Where-Object { $_.serviceName -eq $serviceName })
    Require-True ($service.Count -eq 1 -and $serviceResult.failures.Count -eq 0) 'the named production ECS service must exist exactly once'
    $service = $service[0]
    Require-True ($service.desiredCount -ge 1 -and $service.runningCount -eq $service.desiredCount -and $service.pendingCount -eq 0) 'production ECS service must be steady before preflight'
    $taskDef = Invoke-AwsRead @('ecs','describe-task-definition','--task-definition',$service.taskDefinition)
    Require-True ($taskDef.taskDefinition.family -eq $taskFamily -and [int]$taskDef.taskDefinition.revision -eq $ExpectedTaskRevision) 'production ECS task definition must match the explicitly reviewed family and revision'
    Require-True ($taskDef.taskDefinition.networkMode -eq 'awsvpc' -and @($taskDef.taskDefinition.requiresCompatibilities) -contains 'FARGATE' -and $service.networkConfiguration.awsvpcConfiguration) 'production task must support isolated Fargate awsvpc inspection'
    $taskContainer = @($taskDef.taskDefinition.containerDefinitions | Where-Object { $_.name -eq 'tracepoint' })
    Require-True ($taskContainer.Count -eq 1) 'production task definition must have one TracePoint application container'
    $mobileClientEnvironment = @($taskContainer[0].environment | Where-Object { $_.name -eq 'TRACEPOINT_COGNITO_MOBILE_CLIENT_ID' })
    if (-not [string]::IsNullOrWhiteSpace($ExpectedProductionMobileClientId)) {
        Require-True ($mobileClientEnvironment.Count -eq 1 -and $mobileClientEnvironment[0].value -eq $ExpectedProductionMobileClientId) 'production ECS task must use the reviewed dedicated mobile Cognito client id'
    } elseif ($mobileClientEnvironment.Count -ne 0) {
        $script:Blockers.Add('Production ECS task already contains a mobile Cognito client id; supply its reviewed value to verify it.')
    } else {
        $script:Blockers.Add('Production ECS task definition needs TRACEPOINT_COGNITO_MOBILE_CLIENT_ID for the dedicated public mobile client.')
    }
    $tasksResult = Invoke-AwsRead @('ecs','list-tasks','--cluster',$clusterName,'--service-name',$serviceName,'--desired-status','RUNNING')
    $taskArns = @($tasksResult.taskArns)
    Require-True ($taskArns.Count -eq $service.desiredCount) 'all desired production tasks must be discoverable'
    $tasks = Invoke-AwsRead @('ecs','describe-tasks','--cluster',$clusterName,'--tasks',$taskArns)
    Require-True ($tasks.failures.Count -eq 0) 'all production task descriptions must succeed'
    $digests = @($tasks.tasks | ForEach-Object { $_.containers | Where-Object { $_.name -eq 'tracepoint' } | ForEach-Object { $_.imageDigest } } | Sort-Object -Unique)
    Require-True ($digests.Count -eq 1 -and $digests[0] -eq $ExpectedProductionImageDigest) 'running production tasks must match the explicitly reviewed image digest'
    $script:Evidence.checks.ecs = @{ passed = $true; taskDefinition = $service.taskDefinition; runningCount = $service.runningCount; imageDigest = $digests[0] }

    $poolResult = Invoke-AwsRead @('cognito-idp','describe-user-pool','--user-pool-id',$poolId)
    $pool = $poolResult.UserPool
    Require-True ($pool.Id -eq $poolId) 'production Cognito pool id must match'
    Require-True ($pool.MfaConfiguration -eq $expectedMfaConfiguration) 'production Cognito MFA must remain ON'
    $domainResult = Invoke-AwsRead @('cognito-idp','describe-user-pool-domain','--domain',$poolDomain)
    Require-True ($domainResult.DomainDescription.UserPoolId -eq $poolId) 'production managed-login domain must belong to the production pool'
    $listed = Invoke-AwsRead @('cognito-idp','list-user-pool-clients','--user-pool-id',$poolId,'--max-results','60')
    $clients = @($listed.UserPoolClients)
    foreach ($name in $requiredClientNames) { Require-True (@($clients | Where-Object { $_.ClientName -eq $name }).Count -eq 1) "expected existing Cognito client $name" }
    $web = @($clients | Where-Object { $_.ClientName -eq $webClientName })[0]
    $webDetails = Invoke-AwsRead @('cognito-idp','describe-user-pool-client','--user-pool-id',$poolId,'--client-id',$web.ClientId)
    Require-True ($webDetails.UserPoolClient.ClientId -eq $web.ClientId -and $webDetails.UserPoolClient.AllowedOAuthFlowsUserPoolClient -eq $true) 'existing web OAuth client must remain present and enabled'
    $mobileClients = @($clients | Where-Object { $_.ClientName -eq 'tracepoint-production-mobile' })
    if ([string]::IsNullOrWhiteSpace($ExpectedProductionMobileClientId)) {
        if ($mobileClients.Count -ne 0) { throw 'A production mobile client exists but its reviewed client id was not supplied.' }
        $script:Blockers.Add('Dedicated production Cognito mobile client is not yet provisioned.')
    } else {
        Require-True ($mobileClients.Count -eq 1 -and $mobileClients[0].ClientId -eq $ExpectedProductionMobileClientId) 'dedicated Cognito mobile client id/name must match reviewed configuration'
        $mobileDetails = Invoke-AwsRead @('cognito-idp','describe-user-pool-client','--user-pool-id',$poolId,'--client-id',$ExpectedProductionMobileClientId)
        $mobile = $mobileDetails.UserPoolClient
        Require-True ($mobile.GenerateSecret -eq $false -and $mobile.AllowedOAuthFlowsUserPoolClient -eq $true -and @($mobile.AllowedOAuthFlows) -contains 'code' -and $mobile.EnableTokenRevocation -eq $true) 'mobile Cognito client must be public, authorization-code only, and enable refresh-token revocation'
        Require-True (@($mobile.CallbackURLs).Count -eq 1 -and @($mobile.CallbackURLs) -contains $expectedProductionMobileCallbackUrl) 'mobile callback must be exactly tracepoint://auth'
        foreach ($scope in @('openid','email','profile','aws.cognito.signin.user.admin')) { Require-True (@($mobile.AllowedOAuthScopes) -contains $scope) "mobile OAuth scope $scope must be present" }
    }
    $script:Evidence.checks.cognito = @{ passed = $true; mfa = $pool.MfaConfiguration; webClientId = $web.ClientId; mobileClientPresent = ($mobileClients.Count -eq 1); mobileLogout = 'backend endpoint plus refresh-token revocation' }

    $dbInstanceResult = Invoke-AwsRead @('rds','describe-db-instances','--db-instance-identifier',$DatabaseInstanceIdentifier)
    Require-True (@($dbInstanceResult.DBInstances).Count -eq 1) 'named production database instance must exist exactly once'
    $db = $dbInstanceResult.DBInstances[0]
    Require-True ($db.DBInstanceIdentifier -eq $DatabaseInstanceIdentifier -and $db.DBInstanceStatus -eq 'available' -and $db.Engine -match 'postgres' -and -not (Get-OptionalPropertyValue $db 'DBClusterIdentifier')) 'production standalone PostgreSQL database instance must be available'
    Require-True (@($InspectionSubnetIds | Select-Object -Unique).Count -eq $InspectionSubnetIds.Count -and @($InspectionSecurityGroupIds | Select-Object -Unique).Count -eq $InspectionSecurityGroupIds.Count) 'inspection network inputs must contain unique subnet and security-group ids'
    $network = [pscustomobject]@{ subnets = @($InspectionSubnetIds); securityGroups = @($InspectionSecurityGroupIds); assignPublicIp = $InspectionAssignPublicIp }
    $subnetArguments = @('ec2','describe-subnets','--subnet-ids') + @($InspectionSubnetIds)
    $inspectionSubnets = Invoke-AwsRead $subnetArguments
    Require-True (@($inspectionSubnets.Subnets).Count -eq $InspectionSubnetIds.Count -and -not [string]::IsNullOrWhiteSpace([string]$db.DBSubnetGroup.VpcId) -and @($inspectionSubnets.Subnets | Where-Object { $_.VpcId -ne $db.DBSubnetGroup.VpcId }).Count -eq 0) 'approved inspection subnets must all exist in the production database VPC'
    $databaseSecurityGroupIds = @($db.VpcSecurityGroups | ForEach-Object { $_.VpcSecurityGroupId })
    Require-True ($databaseSecurityGroupIds.Count -gt 0 -and @($network.securityGroups).Count -gt 0) 'database and inspection task must have explicit VPC security groups'
    $taskSecurityGroups = Invoke-AwsRead @('ec2','describe-security-groups','--group-ids',($network.securityGroups -join ','))
    $databaseSecurityGroups = Invoke-AwsRead @('ec2','describe-security-groups','--group-ids',($databaseSecurityGroupIds -join ','))
    Require-True (@($taskSecurityGroups.SecurityGroups).Count -eq $InspectionSecurityGroupIds.Count -and @($taskSecurityGroups.SecurityGroups | Where-Object { $_.VpcId -ne $db.DBSubnetGroup.VpcId }).Count -eq 0) 'approved inspection security groups must all exist in the production database VPC'
    $hasDatabaseEgress = $false
    foreach ($taskSecurityGroup in @($taskSecurityGroups.SecurityGroups)) {
        foreach ($rule in @($taskSecurityGroup.IpPermissionsEgress)) {
            $portAllowsPostgres = ($rule.IpProtocol -eq '-1') -or ($rule.IpProtocol -eq 'tcp' -and [int]$rule.FromPort -le 5432 -and [int]$rule.ToPort -ge 5432)
            if ($portAllowsPostgres -and @($rule.UserIdGroupPairs | Where-Object { $databaseSecurityGroupIds -contains $_.GroupId }).Count -gt 0) { $hasDatabaseEgress = $true }
        }
    }
    $hasDatabaseIngress = $false
    foreach ($databaseSecurityGroup in @($databaseSecurityGroups.SecurityGroups)) {
        foreach ($rule in @($databaseSecurityGroup.IpPermissions)) {
            $portAllowsPostgres = ($rule.IpProtocol -eq '-1') -or ($rule.IpProtocol -eq 'tcp' -and [int]$rule.FromPort -le 5432 -and [int]$rule.ToPort -ge 5432)
            if ($portAllowsPostgres -and @($rule.UserIdGroupPairs | Where-Object { @($network.securityGroups) -contains $_.GroupId }).Count -gt 0) { $hasDatabaseIngress = $true }
        }
    }
    Require-True ($hasDatabaseEgress -and $hasDatabaseIngress) 'production inspection task and database security groups must permit only the reviewed PostgreSQL security-group path'
    $taskHasPublicIngress = @($taskSecurityGroups.SecurityGroups | ForEach-Object { $_.IpPermissions } | Where-Object { @($_.IpRanges | Where-Object { $_.CidrIp -eq '0.0.0.0/0' }).Count -gt 0 -or @($_.Ipv6Ranges | Where-Object { $_.CidrIpv6 -eq '::/0' }).Count -gt 0 }).Count -gt 0
    Require-True (-not $taskHasPublicIngress) 'inspection task security groups must not allow unrestricted public inbound traffic'
    $recovery = Invoke-AwsRead @('backup','list-recovery-points-by-backup-vault','--backup-vault-name',$BackupVaultName)
    $usableRecovery = @($recovery.RecoveryPoints | Where-Object { $_.ResourceArn -eq $db.DBInstanceArn -and $_.Status -eq 'COMPLETED' -and $_.IsEncrypted -eq $true -and $_.RecoveryPointArn }) | Sort-Object CreationDate -Descending
    Require-True ($usableRecovery.Count -gt 0) 'a completed encrypted recovery point for the production DB instance must exist'
    $ageHours = ([DateTimeOffset]::UtcNow - [DateTimeOffset]$usableRecovery[0].CreationDate).TotalHours
    Require-True ($ageHours -ge 0 -and $ageHours -le 48) 'latest completed production database recovery point must be no older than 48 hours'
    $script:Evidence.checks.network = @{ passed = $true; approvalReference = $InspectionNetworkAuthorizationReference; taskSubnets = @($network.subnets); taskSecurityGroups = @($network.securityGroups); databaseSecurityGroups = $databaseSecurityGroupIds; assignPublicIp = $network.assignPublicIp; postgresPath = 'security-group-to-security-group only'; unrestrictedPublicIngress = $false }
    $script:Evidence.checks.backup = @{ passed = $true; recoveryPointArn = $usableRecovery[0].RecoveryPointArn; ageHours = [Math]::Round($ageHours,2); databaseInstanceArn = $db.DBInstanceArn }

    $root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    foreach ($route in $productionApiRoutes) { Require-True (Test-Path -LiteralPath (Join-Path $root $route) -PathType Leaf) "mobile API dependency source is missing: $route" }
    $routeContract = Get-Content -Raw -LiteralPath (Join-Path $root 'src/lib/tracepoint/mobile-production-contract.test.mjs')
    Require-True ($routeContract.Contains('resolveServerAccess') -and $routeContract.Contains('department_id') -and $routeContract.Contains('dedicated public client')) 'mobile route contract must retain bearer authentication, agency scoping, and dedicated-client regression assertions'
    $script:Evidence.checks.mobileApiSource = @{ passed = $true; requiredRouteCount = $productionApiRoutes.Count }

    # Build an isolated task definition from the pinned production definition.
    # The explicit, operation-approved subnets and security groups are used for
    # this task; the application task role is removed.
    Require-True ($InspectionImageDigest -ne $ExpectedProductionImageDigest) 'inspection image must be the separately reviewed candidate containing the mobile-preflight action, not the currently deployed production image'
    $inspectionImage = Invoke-AwsRead @('ecr','describe-images','--repository-name','tracepoint-production','--image-ids',"imageDigest=$InspectionImageDigest")
    Require-True (@($inspectionImage.imageDetails).Count -eq 1) 'reviewed inspection image digest must exist in production ECR'
    $inspectionImageTag = "migration-$InspectionImageSourceCommit-aws-native-production"
    $taggedInspectionImage = Invoke-AwsRead @('ecr','describe-images','--repository-name','tracepoint-production','--image-ids',"imageTag=$inspectionImageTag")
    Require-True (@($taggedInspectionImage.imageDetails).Count -eq 1 -and $taggedInspectionImage.imageDetails[0].imageDigest -eq $InspectionImageDigest) 'inspection image digest must exactly match the immutable migration image tag for the reviewed source commit'
    $inspectionScan = Invoke-AwsRead @('ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id',"imageDigest=$InspectionImageDigest")
    Require-True ($inspectionScan.imageScanStatus.status -eq 'COMPLETE') 'reviewed inspection image scan must be complete'
    $inspectionFindings = $inspectionScan.imageScanFindings.findingSeverityCounts
    Require-True ($null -eq $inspectionFindings -or @($inspectionFindings.PSObject.Properties | Where-Object { [int]$_.Value -gt 0 }).Count -eq 0) 'reviewed inspection image scan must have zero findings at every severity'
    $taskDefinition = $taskDef.taskDefinition
    $sourceContainer = @($taskDefinition.containerDefinitions | Where-Object { $_.name -eq 'tracepoint' })
    Require-True ($sourceContainer.Count -eq 1) 'one-off inspection requires exactly one TracePoint container'
    $dbSecrets = @($sourceContainer[0].secrets | Where-Object { $_.name -eq 'TRACEPOINT_DATABASE_SECRET_JSON' })
    Require-True ($dbSecrets.Count -eq 1) 'production task definition must inject the database secret through ECS Secrets Manager integration'
    Require-True ([string]$dbSecrets[0].valueFrom -match '^arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/') 'database secret reference must remain the reviewed production Secrets Manager secret'
    Require-True ([string]$taskDefinition.executionRoleArn -eq $ExpectedExecutionRoleArn) 'production task definition must use the explicitly reviewed ECS execution role'
    $awsLogs = $sourceContainer[0].logConfiguration
    Require-True ($awsLogs.logDriver -eq 'awslogs' -and $awsLogs.options.'awslogs-group' -like '/tracepoint/production/*' -and $awsLogs.options.'awslogs-region' -eq $region -and $awsLogs.options.'awslogs-stream-prefix') 'existing production task must provide the reviewed production CloudWatch log group and region'
    $inspectionImageUri = "193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@$InspectionImageDigest"
    $inspectionContainer = [ordered]@{
        name = 'tracepoint'
        image = $inspectionImageUri
        essential = $true
        entryPoint = @('/nodejs/bin/node')
        command = @('scripts/run-aws-native-migrations.mjs','mobile-preflight','production')
        workingDirectory = '/app'
        user = '65532:65532'
        readonlyRootFilesystem = $true
        environment = @(
        @{ name='CONFIGURATION_ENVIRONMENT'; value='production' },
        @{ name='TRACEPOINT_DATA_PROVIDER'; value='postgres' },
        @{ name='TRACEPOINT_RUNTIME_PROVIDER_MODE'; value='aws-native' },
        @{ name='TRACEPOINT_DATABASE_CA_PATH'; value='/app/rds-ca.pem' }
        )
        secrets = $dbSecrets
        logConfiguration = $awsLogs
    }
    $inspectionDefinition = [ordered]@{
        family = $inspectionTaskFamily
        executionRoleArn = $taskDefinition.executionRoleArn
        networkMode = 'awsvpc'
        requiresCompatibilities = @('FARGATE')
        cpu = $taskDefinition.cpu
        memory = $taskDefinition.memory
        containerDefinitions = @($inspectionContainer)
    }
    $runtimePlatform = Get-OptionalPropertyValue $taskDefinition 'runtimePlatform'
    $ephemeralStorage = Get-OptionalPropertyValue $taskDefinition 'ephemeralStorage'
    if ($runtimePlatform) { $inspectionDefinition.runtimePlatform = $runtimePlatform }
    if ($ephemeralStorage) { $inspectionDefinition.ephemeralStorage = $ephemeralStorage }
    Require-True (@($network.subnets).Count -gt 0 -and @($network.securityGroups).Count -gt 0) 'inspection task must use the explicitly approved subnets and database-enabled security group'
    $runId = [Guid]::NewGuid().ToString('N').Substring(0,12)
    $inspectionTaskFamily = "$inspectionTaskFamilyPrefix-$runId"
    $taskDefinitionPath = Join-Path ([IO.Path]::GetTempPath()) "tp-mobile-inspection-$runId.json"
    $taskRunPath = Join-Path ([IO.Path]::GetTempPath()) "tp-mobile-inspection-run-$runId.json"
    $utf8NoBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
    $registered = $null
    $inspectionTaskArn = $null
    $inspectionTaskArns = @()
    $taskStopped = $false
    $registrationSubmitted = $false
    $runSubmitted = $false
    $runResponseReceived = $false
    $launchUnresolved = $false
    try {
        [IO.File]::WriteAllText($taskDefinitionPath,($inspectionDefinition | ConvertTo-Json -Depth 40 -Compress),$utf8NoBom)
        $registrationSubmitted = $true
        $registered = Invoke-AwsAuthorizedInspectionMutation @('ecs','register-task-definition','--cli-input-json',"file://$taskDefinitionPath")
        $registeredContainer = @($registered.taskDefinition.containerDefinitions | Where-Object { $_.name -eq 'tracepoint' })
        Require-True (
            $registered.taskDefinition.family -eq $inspectionTaskFamily -and
            -not (Get-OptionalPropertyValue $registered.taskDefinition 'taskRoleArn') -and
            $registered.taskDefinition.executionRoleArn -eq $taskDefinition.executionRoleArn -and
            $registeredContainer.Count -eq 1 -and
            $registeredContainer[0].image -eq $inspectionImageUri -and
            $registeredContainer[0].entryPoint[0] -eq '/nodejs/bin/node' -and
            (($registeredContainer[0].command -join ' ') -eq 'scripts/run-aws-native-migrations.mjs mobile-preflight production') -and
            $registeredContainer[0].user -eq '65532:65532' -and
            $registeredContainer[0].readonlyRootFilesystem -eq $true -and
            @($registeredContainer[0].secrets).Count -eq 1 -and
            $registeredContainer[0].secrets[0].name -eq 'TRACEPOINT_DATABASE_SECRET_JSON'
        ) 'registered inspection task definition must match the fixed non-root, no-task-role, one-secret inspection contract'
        $runRequest = @{
            cluster = $clusterName
            taskDefinition = $registered.taskDefinition.taskDefinitionArn
            launchType = 'FARGATE'
            count = 1
            startedBy = "TPMobile-$runId"
            networkConfiguration = @{ awsvpcConfiguration = @{ subnets = @($InspectionSubnetIds); securityGroups = @($InspectionSecurityGroupIds); assignPublicIp = $InspectionAssignPublicIp } }
        }
        [IO.File]::WriteAllText($taskRunPath,($runRequest | ConvertTo-Json -Depth 20 -Compress),$utf8NoBom)
        $runSubmitted = $true
        $launched = Invoke-AwsAuthorizedInspectionMutation @('ecs','run-task','--cli-input-json',"file://$taskRunPath")
        $runResponseReceived = $true
        $inspectionTaskArns = @($launched.tasks | ForEach-Object { $_.taskArn } | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($inspectionTaskArns.Count -gt 0) { $inspectionTaskArn = $inspectionTaskArns[0] }
        Require-True (@($launched.failures).Count -eq 0 -and @($launched.tasks).Count -eq 1) 'one-off production inspection task must launch without ECS service changes'
        $inspectionTaskId = ($inspectionTaskArn -split '/')[-1]
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            Start-Sleep -Seconds 10
            $taskState = Invoke-AwsRead @('ecs','describe-tasks','--cluster',$clusterName,'--tasks',$inspectionTaskArn)
            Require-True (@($taskState.failures).Count -eq 0 -and @($taskState.tasks).Count -eq 1) 'one-off inspection task state must remain discoverable'
            if ($taskState.tasks[0].lastStatus -eq 'STOPPED') { $taskStopped = $true; break }
        }
        Require-True $taskStopped 'one-off database inspection must stop within ten minutes'
        $inspectionContainerState = @($taskState.tasks[0].containers | Where-Object { $_.name -eq 'tracepoint' })
        Require-True ($inspectionContainerState.Count -eq 1 -and $inspectionContainerState[0].exitCode -eq 0) 'one-off database inspection container must exit successfully'
        $logGroup = $awsLogs.options.'awslogs-group'
        $logPrefix = $awsLogs.options.'awslogs-stream-prefix'
        $streamName = "$logPrefix/tracepoint/$inspectionTaskId"
        $logResult = $null
        for ($attempt = 0; $attempt -lt 12 -and -not $logResult; $attempt++) {
            try { $logResult = Invoke-AwsRead @('logs','get-log-events','--log-group-name',$logGroup,'--log-stream-name',$streamName,'--limit','20') }
            catch { Start-Sleep -Seconds 5 }
        }
        $inspection = $null
        foreach ($event in @($logResult.events)) {
            $candidate = [string]$event.message
            if ($candidate.TrimStart().StartsWith('{')) { try { $parsed = $candidate | ConvertFrom-Json; if ($parsed.mobileApiDependencies) { $inspection = $parsed } } catch {} }
        }
        Require-True ($inspection -and $inspection.status -eq 'PASSED' -and $inspection.inspection -eq 'read-only' -and $inspection.transaction.readOnly -eq $true) 'read-only mobile database inspection evidence must be returned as sanitized JSON'
        Require-True ($inspection.databasePrincipal.database_user -eq 'tracepoint_runtime' -and $inspection.databasePrincipal.transaction_read_only -eq 'on' -and $inspection.databasePrincipal.transaction_isolation -eq 'repeatable read' -and $inspection.databasePrincipal.is_superuser -eq $false -and $inspection.databasePrincipal.can_create_database -eq $false -and $inspection.databasePrincipal.can_create_roles -eq $false -and $inspection.databasePrincipal.can_replicate -eq $false -and $inspection.databasePrincipal.can_bypass_rls -eq $false) 'inspection must use the least-privilege tracepoint_runtime database role in a verified read-only repeatable-read transaction'
    } finally {
        Remove-Item -LiteralPath $taskDefinitionPath,$taskRunPath -Force -ErrorAction SilentlyContinue
        if ($registrationSubmitted -and -not $registered) {
            try {
                $definitions = Invoke-AwsRead @('ecs','list-task-definitions','--family-prefix',$inspectionTaskFamily,'--status','ACTIVE')
                $candidateArns = @($definitions.taskDefinitionArns)
                if ($candidateArns.Count -eq 1) {
                    $candidate = (Invoke-AwsRead @('ecs','describe-task-definition','--task-definition',$candidateArns[0])).taskDefinition
                    $candidateContainer = @($candidate.containerDefinitions | Where-Object { $_.name -eq 'tracepoint' })
                    Require-True ($candidate.family -eq $inspectionTaskFamily -and $candidateContainer.Count -eq 1 -and $candidateContainer[0].image -eq $inspectionImageUri -and (($candidateContainer[0].command -join ' ') -eq 'scripts/run-aws-native-migrations.mjs mobile-preflight production')) 'ambiguous ECS registration must resolve only to this unique inspection task definition'
                    $registered = [pscustomobject]@{ taskDefinition = $candidate }
                } elseif ($candidateArns.Count -gt 1) {
                    $script:Blockers.Add('Ambiguous inspection registration produced multiple task definitions in its unique family; inspect and clean them up before release.')
                }
            } catch {
                $script:Blockers.Add('The inspection task definition registration result was ambiguous; inspect the unique task family and clean it up before release.')
            }
        }
        if ($runSubmitted -and -not $runResponseReceived -and $inspectionTaskArns.Count -eq 0) {
            try {
                $uncertainLaunches = @()
                for ($discoverAttempt = 0; $discoverAttempt -lt 6 -and $uncertainLaunches.Count -eq 0; $discoverAttempt++) {
                    foreach ($desiredStatus in @('RUNNING','STOPPED')) {
                    $listed = Invoke-AwsRead @('ecs','list-tasks','--cluster',$clusterName,'--family',$inspectionTaskFamily,'--desired-status',$desiredStatus)
                        if (@($listed.taskArns).Count -gt 0) {
                            $described = Invoke-AwsRead @('ecs','describe-tasks','--cluster',$clusterName,'--tasks',$listed.taskArns)
                            $uncertainLaunches += @($described.tasks | Where-Object { $_.startedBy -eq "TPMobile-$runId" })
                        }
                    }
                    if ($uncertainLaunches.Count -eq 0) { Start-Sleep -Seconds 5 }
                }
                $inspectionTaskArns = @($uncertainLaunches | ForEach-Object { $_.taskArn } | Sort-Object -Unique)
                if ($inspectionTaskArns.Count -gt 0) { $inspectionTaskArn = $inspectionTaskArns[0] }
                $taskStopped = ($inspectionTaskArns.Count -gt 0 -and @($uncertainLaunches | Where-Object { $_.lastStatus -ne 'STOPPED' }).Count -eq 0)
                if ($inspectionTaskArns.Count -eq 0) { $launchUnresolved = $true }
            } catch {
                $launchUnresolved = $true
                $script:Blockers.Add('The one-off task launch result was ambiguous and its task identity could not be confirmed; verify the task family before cleanup or release.')
            }
            if ($launchUnresolved) { $script:Blockers.Add('The one-off task launch result remains ambiguous; the temporary task definition was retained for manual verification.') }
        }
        if ($inspectionTaskArns.Count -gt 0 -and -not $taskStopped) {
            try {
                foreach ($taskArn in $inspectionTaskArns) {
                    $null = Invoke-AwsAuthorizedInspectionMutation @('ecs','stop-task','--cluster',$clusterName,'--task',$taskArn,'--reason','Read-only mobile release preflight timeout')
                }
                for ($stopAttempt = 0; $stopAttempt -lt 24; $stopAttempt++) {
                    Start-Sleep -Seconds 5
                    $stoppedState = Invoke-AwsRead @('ecs','describe-tasks','--cluster',$clusterName,'--tasks',$inspectionTaskArns)
                    $taskStopped = (@($stoppedState.tasks).Count -eq $inspectionTaskArns.Count -and @($stoppedState.tasks | Where-Object { $_.lastStatus -ne 'STOPPED' }).Count -eq 0)
                    if ($taskStopped) { break }
                }
                if (-not $taskStopped) { $script:Blockers.Add('Timed-out one-off inspection task did not reach STOPPED within two minutes; inspect it before release.') }
            } catch { $script:Blockers.Add('Timed-out one-off inspection task could not be stopped and confirmed stopped; inspect it before release.') }
        }
        if ($registered -and $registered.taskDefinition.taskDefinitionArn) {
            if ($launchUnresolved -or ($inspectionTaskArns.Count -gt 0 -and -not $taskStopped)) {
                $script:Blockers.Add('Temporary inspection task definition was retained because its task may still be running; stop and inspect the task before cleanup.')
            } else {
                try { $null = Invoke-AwsAuthorizedInspectionMutation @('ecs','deregister-task-definition','--task-definition',$registered.taskDefinition.taskDefinitionArn) }
                catch { $script:Blockers.Add('Temporary one-off inspection task definition could not be deregistered; review and clean it up before release.') }
            }
        }
    }
    $status = $inspection
    if ($Phase -eq 'Prerequisites') {
        $pendingVersions = @($status.pending | ForEach-Object { [int]$_.version })
        $appliedVersions = @($status.appliedVersions | ForEach-Object { [int]$_ })
        $exactAppliedChain = $appliedVersions.Count -eq 37
        if ($exactAppliedChain) { for ($index = 0; $index -lt 37; $index++) { if ($appliedVersions[$index] -ne ($index + 1)) { $exactAppliedChain = $false; break } } }
        Require-True ($status.ledger -eq 'present' -and [int]$status.latestAppliedVersion -eq 37 -and $exactAppliedChain -and $pendingVersions.Count -eq 1 -and $pendingVersions[0] -eq 38) 'migration prerequisite phase requires the exact reviewed production 001–037 ledger and only migration 038 pending'
        Require-True ([int]$status.highestContiguousVersion -eq 37 -and @($status.outOfOrderPresent).Count -eq 0) 'production catalog must prove a contiguous 001–037 prerequisite chain'
    } else {
        $appliedVersions = @($status.appliedVersions | ForEach-Object { [int]$_ })
        $exactAppliedChain = $appliedVersions.Count -eq 38
        if ($exactAppliedChain) { for ($index = 0; $index -lt 38; $index++) { if ($appliedVersions[$index] -ne ($index + 1)) { $exactAppliedChain = $false; break } } }
        Require-True ($status.ledger -eq 'present' -and [int]$status.latestAppliedVersion -eq 38 -and $exactAppliedChain -and @($status.pending).Count -eq 0) 'production migration ledger must match the complete repository migration chain through version 038'
        Require-True ([int]$status.highestContiguousVersion -ge 38 -and @($status.outOfOrderPresent).Count -eq 0) 'production catalog must prove contiguous migration lineage through version 038'
    }
    $failedDependencies = @($status.mobileApiDependencies | Where-Object {
        $_.relation_present -ne $true -or $_.required_columns_present -ne $true -or $_.rls_enabled -ne $true -or
        $_.read_privilege_present -ne $true -or $_.policies_present -ne $true -or $_.accountability_trigger_present -ne $true -or
        ($Phase -eq 'ReleaseReady' -and $_.write_privileges_present -ne $true)
    })
    Require-True ($failedDependencies.Count -eq 0) 'production mobile API tables, columns, RLS, grants, policies, or audit trigger are incomplete'
    $script:Evidence.checks.database = @{ passed = $true; phase = $Phase; ledgerVersion = $status.latestAppliedVersion; contiguousSchemaVersion = $status.highestContiguousVersion; mobileDependencies = $status.mobileApiDependencies.Count; readOnly = $true; oneOffTaskFamily = 'tracepoint-production-mobile-inspection'; approvalReference = $InspectionAuthorizationReference; inspectionImageSourceCommit = $InspectionImageSourceCommit }

    $repo = Invoke-AwsRead @('ecr','describe-repositories','--repository-names','tracepoint-production')
    Require-True (@($repo.repositories).Count -eq 1 -and $repo.repositories[0].imageTagMutability -eq 'IMMUTABLE') 'production ECR repository must retain immutable tags'
    $image = Invoke-AwsRead @('ecr','describe-images','--repository-name','tracepoint-production','--image-ids',"imageDigest=$ExpectedProductionImageDigest")
    Require-True (@($image.imageDetails).Count -eq 1) 'approved production image digest must exist in ECR'
    $scan = Invoke-AwsRead @('ecr','describe-image-scan-findings','--repository-name','tracepoint-production','--image-id',"imageDigest=$ExpectedProductionImageDigest")
    Require-True ($scan.imageScanStatus.status -eq 'COMPLETE') 'approved image scan must be complete'
    $findings = $scan.imageScanFindings.findingSeverityCounts
    Require-True ($null -eq $findings -or @($findings.PSObject.Properties | Where-Object { [int]$_.Value -gt 0 }).Count -eq 0) 'approved image scan must have zero findings at every severity'
    $script:Evidence.checks.imageGovernance = @{ passed = $true; digest = $ExpectedProductionImageDigest; scan = 'COMPLETE'; immutableTags = $true }

    if ($script:Blockers.Count -gt 0) {
        $script:Evidence.result = 'NO-GO'
        $script:Evidence.blockers = @($script:Blockers)
        $script:Evidence | ConvertTo-Json -Depth 12
        exit 2
    }
    $script:Evidence.result = 'GO for separately approved production release actions'
    $script:Evidence.blockers = @()
    $script:Evidence | ConvertTo-Json -Depth 12
} catch {
    $script:Evidence.result = 'NO-GO'
    $script:Evidence.failure = $_.Exception.Message
    $script:Evidence.blockers = @($script:Blockers)
    $script:Evidence | ConvertTo-Json -Depth 12
    exit 1
}
