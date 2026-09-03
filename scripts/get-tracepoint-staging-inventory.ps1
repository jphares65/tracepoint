[CmdletBinding()]
param([string]$Profile = 'tracepoint-member-staging')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force

$identity = Assert-TracePointStagingIdentity -Profile $Profile
Write-Host "Verified account $($identity.Account), role TracePointMigrationStaging, region us-east-1."
Write-Host 'Inventory is metadata-only; no secret values, objects, logs, records, or DNS data are read.'

function Invoke-InventoryQuery {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    $output = & aws.exe @Arguments --profile $Profile --region us-east-1 --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "${Label}: unavailable to the staging role"
        return
    }
    Write-Host "${Label}:"
    Write-Output ($output -join [Environment]::NewLine)
}

Invoke-InventoryQuery 'CloudFormation stacks' @(
    'cloudformation', 'describe-stacks',
    '--query', "Stacks[?StackName=='CDKToolkit' || starts_with(StackName,'tracepoint-staging-')].[StackName,StackStatus]"
)
Invoke-InventoryQuery 'TracePoint VPCs' @(
    'ec2', 'describe-vpcs', '--filters', 'Name=tag:Name,Values=tracepoint-staging',
    '--query', 'Vpcs[].[VpcId,CidrBlock,State]'
)
Invoke-InventoryQuery 'TracePoint subnets' @(
    'ec2', 'describe-subnets', '--filters', 'Name=tag:Name,Values=tracepoint-staging/public-ingressSubnet*',
    '--query', 'Subnets[].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]'
)
Invoke-InventoryQuery 'NAT gateways' @(
    'ec2', 'describe-nat-gateways', '--filter', 'Name=state,Values=available,pending',
    '--query', 'NatGateways[].[NatGatewayId,VpcId,State]'
)
Invoke-InventoryQuery 'VPC endpoints' @(
    'ec2', 'describe-vpc-endpoints', '--filters', 'Name=tag:Application,Values=TracePoint',
    '--query', 'VpcEndpoints[].[VpcEndpointId,VpcEndpointType,State]'
)
Invoke-InventoryQuery 'ECR repositories' @(
    'ecr', 'describe-repositories', '--repository-names', 'tracepoint-staging',
    '--query', 'repositories[].[repositoryName,imageTagMutability,encryptionConfiguration.encryptionType,imageScanningConfiguration.scanOnPush]'
)
Invoke-InventoryQuery 'ECR image metadata' @(
    'ecr', 'describe-images', '--repository-name', 'tracepoint-staging',
    '--query', 'imageDetails[].[imageDigest,imageTags,imageScanStatus.status]'
)
Invoke-InventoryQuery 'ECS cluster' @(
    'ecs', 'describe-clusters', '--clusters', 'tracepoint-staging',
    '--query', 'clusters[].[clusterName,status,runningTasksCount,pendingTasksCount,activeServicesCount]'
)
Invoke-InventoryQuery 'Application log groups' @(
    'logs', 'describe-log-groups', '--log-group-name-prefix', '/tracepoint/staging/',
    '--query', 'logGroups[].[logGroupName,retentionInDays,kmsKeyId]'
)
Invoke-InventoryQuery 'Staging secret metadata' @(
    'secretsmanager', 'list-secrets', '--filters', 'Key=name,Values=tracepoint/staging/',
    '--query', 'SecretList[].[Name,KmsKeyId,LastChangedDate]'
)
Invoke-InventoryQuery 'Load balancers' @(
    'elbv2', 'describe-load-balancers',
    '--query', "LoadBalancers[?starts_with(LoadBalancerName,'tracep')].[LoadBalancerName,State.Code,Scheme,Type]"
)
Invoke-InventoryQuery 'Issued staging certificates' @(
    'acm', 'list-certificates', '--certificate-statuses', 'ISSUED',
    '--query', "CertificateSummaryList[?DomainName=='staging.tracepointhq.com'].[DomainName,Status]"
)
Invoke-InventoryQuery 'Staging budget' @(
    'budgets', 'describe-budgets', '--account-id', '559054714699',
    '--query', "Budgets[?BudgetName=='tracepoint-staging-monthly-75'].[BudgetName,BudgetLimit.Amount,BudgetLimit.Unit]"
)
