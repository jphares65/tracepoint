Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$temporaryRoot=Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-rehearsal-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
foreach($file in @('rehearse-staging-rollback.ps1','TracePoint.Staging.psm1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $temporaryRoot}
function global:aws.exe {
 $global:LASTEXITCODE=0;$command=$args -join ' '
 if($command -like 'sts get-caller-identity*'){return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}'}
 if($command -like 'ecs describe-services*'){return '{"services":[{"taskDefinition":"arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:2"}]}'}
 if($command -like 'ecs describe-task-definition*'){return ('{"taskDefinition":{"status":"ACTIVE","containerDefinitions":[{"image":"559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging:'+('a'*40)+'"}]}}')}
 if($command -like 'ecs update-service*'){
  if($command -notmatch 'synthetic:2'){throw 'Incorrect restoration ARN'}
  $global:RehearsalRestored=$true
  if($global:RehearsalScenario -eq 'restore-failure'){$global:LASTEXITCODE=1;return}
  return '{}'
 }
 if($command -like 'ecs wait services-stable*'){return}
 throw 'Unexpected AWS operation; real network disabled.'
}
function global:node {$global:LASTEXITCODE=0;if($global:RehearsalScenario -eq 'baseline'){$global:LASTEXITCODE=1}}
try {
 @'
param($TaskDefinitionArn,[switch]$Execute)
if(!$Execute){return}
$global:RehearsalChanged=$true
if($global:RehearsalScenario -eq 'rollback-failure'){throw 'Synthetic rollback health failure'}
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'invoke-tracepoint-staging-rollback.ps1')
 'param($WaitSeconds)' | Set-Content -LiteralPath (Join-Path $temporaryRoot 'test-tracepoint-staging-runtime.ps1')
 foreach($scenario in @('success','baseline','rollback-failure','restore-failure')) {
  $global:RehearsalScenario=$scenario;$global:RehearsalChanged=$false;$global:RehearsalRestored=$false;$failed=$false
  try {& (Join-Path $temporaryRoot 'rehearse-staging-rollback.ps1') -CurrentImageTag ('a'*40) -PriorTaskDefinitionArn 'arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:1' -Execute | Out-Null} catch {$failed=$true}
  if($scenario -eq 'success'){if($failed -or !$global:RehearsalChanged -or !$global:RehearsalRestored){throw 'Successful rehearsal did not return current revision'}}
  elseif($scenario -eq 'baseline'){if(!$failed -or $global:RehearsalChanged -or $global:RehearsalRestored){throw 'Failed baseline mutated runtime'}}
  elseif(!$failed -or !$global:RehearsalRestored){throw 'Failure did not attempt restoration or was hidden'}
 }
 Write-Host 'Passed four rollback rehearsal scenarios; zero network calls.'
} finally {
 Remove-Item Function:/aws.exe,Function:/node
 $resolved=[IO.Path]::GetFullPath($temporaryRoot)
 if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -notlike 'tracepoint-rehearsal-test-*'){throw 'Temporary cleanup boundary failed'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
