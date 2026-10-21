Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# deploy-app.ps1 -PublishOnly must publish (or reuse) and scan-check the reviewed
# image, then stop before any task-definition registration or ECS service update.
# All AWS, git and node calls are mocked; nothing leaves this process.
$temporaryRoot=Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-publish-only-test-'+[guid]::NewGuid().ToString('N'))
$scriptRoot=Join-Path $temporaryRoot 'scripts'
New-Item -ItemType Directory -Path $scriptRoot | Out-Null
foreach($file in @('deploy-app.ps1','deploy-app-rollout-core.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $scriptRoot}
$global:PublishOnlySha='b'*40
$global:PublishOnlyCalls=[System.Collections.Generic.List[string]]::new()
function global:git.exe {
 $global:LASTEXITCODE=0;$command=$args -join ' '
 if($command -like '*rev-parse HEAD*'){return $global:PublishOnlySha}
 if($command -like '*status --porcelain*'){return}
 throw "Unexpected git operation: $command"
}
function global:node.exe {$global:LASTEXITCODE=0}
function global:aws.exe {
 $global:LASTEXITCODE=0;$command=$args -join ' ';$global:PublishOnlyCalls.Add($command)
 if($command -like 'sts get-caller-identity*'){return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}'}
 if($command -like 'ecs describe-services*'){return '{"services":[{"status":"ACTIVE","clusterArn":"arn:aws:ecs:us-east-1:559054714699:cluster/tracepoint-staging","serviceArn":"arn:aws:ecs:us-east-1:559054714699:service/tracepoint-staging/tracepoint-staging","deploymentController":{"type":"ECS"},"taskDefinition":"arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:7","desiredCount":1}]}'}
 if($command -like 'ecr describe-images*'){
  if($command -notlike "*imageTag=$($global:PublishOnlySha)-aws-native-staging*"){throw "Unexpected image tag lookup: $command"}
  return ('{"imageDetails":[{"imageDigest":"sha256:'+('c'*64)+'"}]}')
 }
 if($command -like 'ecr batch-get-image*'){return '{"images":[{}]}'}
 if($command -like 'ecr describe-image-scan-findings*'){return '{"imageScanStatus":{"status":"COMPLETE"},"imageScanFindings":{"findingSeverityCounts":null}}'}
 if($command -match 'register-task-definition|update-service|start-build|put-object|describe-task-definition'){throw "PublishOnly reached a deployment operation: $command"}
 throw "Unexpected AWS operation; real network disabled: $command"
}
function Invoke-DeployApp([hashtable]$Arguments){
 $global:PublishOnlyCalls.Clear()
 & (Join-Path $scriptRoot 'deploy-app.ps1') @Arguments
}
try {
 Invoke-DeployApp @{Environment='staging';PublishOnly=$true;SkipLocalValidation=$true}
 if($LASTEXITCODE -ne 0){throw 'PublishOnly did not exit successfully.'}
 if(@($global:PublishOnlyCalls | Where-Object {$_ -like 'ecr describe-image-scan-findings*'}).Count -eq 0){throw 'PublishOnly skipped the image scan gate.'}
 if(@($global:PublishOnlyCalls | Where-Object {$_ -match '^ecs (register-task-definition|update-service)'}).Count -ne 0){throw 'PublishOnly changed ECS.'}

 $rejected=$false
 try { Invoke-DeployApp @{Environment='staging';PublishOnly=$true;SkipLocalValidation=$true;RollbackTaskDefinitionArn='arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint-staging:6'} } catch { $rejected=$_.Exception.Message -like '*cannot be combined*' }
 if(-not $rejected -or $global:PublishOnlyCalls.Count -ne 0){throw 'PublishOnly with a rollback target was not refused before any AWS call.'}

 # Without -PublishOnly the same state proceeds to task registration, proving
 # the mock would have caught a missing early exit.
 $reachedDeployment=$false
 try { Invoke-DeployApp @{Environment='staging';SkipLocalValidation=$true} } catch { $reachedDeployment=$_.Exception.Message -like '*reached a deployment operation*' }
 if(-not $reachedDeployment){throw 'Control run did not reach the deployment step.'}
 Write-Host 'deploy-app PublishOnly regression tests passed.'
}
finally {
 foreach($name in @('git.exe','node.exe','aws.exe')){Remove-Item -LiteralPath "Function:\$name" -ErrorAction SilentlyContinue}
 if(Test-Path -LiteralPath $temporaryRoot){Remove-Item -LiteralPath $temporaryRoot -Recurse -Force}
}
