Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$temporaryRoot=Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-release-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'release-tracepoint-staging.ps1') -Destination $temporaryRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Destination $temporaryRoot
$global:ReleaseTestCalls=@()
function global:aws.exe {
 $global:LASTEXITCODE=0
 if (($args -join ' ') -like 'sts get-caller-identity*') { return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}' }
 if (($args -join ' ') -like 'ecs describe-services*') {return "arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:$global:ReleaseTestRevision"}
 if (($args -join ' ') -like 'ecs wait services-stable*') {return}
 throw 'Unexpected AWS call; real AWS is unavailable to this test.'
}
function global:node {
 $global:LASTEXITCODE=0
 $command=$args -join ' '
 $global:ReleaseTestCalls+= $command
 if($global:ReleaseTestScenario -eq 'stderr' -and $command -match '--range-documents') {Write-Error 'Synthetic child error before finally';$global:ReleaseTestCalls+='child-cleanup';$global:LASTEXITCODE=1;return}
 if (($global:ReleaseTestScenario -eq 'preflight' -and $command -match '--fixtures-only') -or
     ($global:ReleaseTestScenario -eq 'acceptance' -and $command -match '--range-documents') -or
     ($global:ReleaseTestScenario -eq 'evidence' -and $command -match 'collect-staging-release-evidence')) {$global:LASTEXITCODE=1}
}
try {
 @'
param($Action,$ImageTag,$CertificateArn,$StorageProvider)
if($StorageProvider -ne 's3'){throw 'Storage provider was not preserved'}
$global:ReleaseTestCalls+='deploy'
$global:ReleaseTestRevision=2
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'deploy-tracepoint-staging.ps1')
 @'
param($WaitSeconds)
if($global:ReleaseTestRevision -eq 2 -and $WaitSeconds -ne 900){throw 'Rollout settling wait missing'}
$global:ReleaseTestCalls+='runtime'
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'test-tracepoint-staging-runtime.ps1')
 @'
param($TaskDefinitionArn,[switch]$Execute)
if($TaskDefinitionArn -notmatch ':1$' -or !$Execute){throw 'Wrong rollback target'}
$global:ReleaseTestCalls+='rollback'
$global:ReleaseTestRevision=1
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'invoke-tracepoint-staging-rollback.ps1')
 foreach($scenario in @('success','preflight','acceptance','evidence','stderr')) {
  $global:ReleaseTestScenario=$scenario;$global:ReleaseTestRevision=1;$global:ReleaseTestCalls=@();$failed=$false
  try {& (Join-Path $temporaryRoot 'release-tracepoint-staging.ps1') -ImageTag ('a'*40) -CertificateArn 'synthetic'} catch {$failed=$true}
  if($scenario -eq 'success') {if($failed -or $global:ReleaseTestRevision -ne 2 -or $global:ReleaseTestCalls -contains 'rollback'){throw 'Successful release incorrectly rolled back'}}
  elseif($scenario -eq 'preflight') {if(!$failed -or $global:ReleaseTestCalls -contains 'deploy'){throw 'Failed authentication preflight deployed'}}
  elseif(!$failed -or $global:ReleaseTestRevision -ne 1 -or $global:ReleaseTestCalls -notcontains 'rollback'){throw 'Failed release did not restore prior revision'}
  if($scenario -eq 'stderr' -and $global:ReleaseTestCalls -notcontains 'child-cleanup'){throw 'Native error interrupted child cleanup'}
 }
 Write-Host 'Passed five release orchestration cases: success, preflight denial, acceptance rollback, evidence rollback, stderr cleanup. Zero network calls.'
} finally {
 Remove-Item Function:/aws.exe,Function:/node
 $resolved=[IO.Path]::GetFullPath($temporaryRoot)
 if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -notlike 'tracepoint-release-test-*'){throw 'Temporary cleanup boundary failed'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
