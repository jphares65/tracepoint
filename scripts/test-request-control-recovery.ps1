Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$directory=Join-Path ([IO.Path]::GetTempPath()) ('tp-request-recovery-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory|Out-Null
Copy-Item (Join-Path $PSScriptRoot 'enforce-staging-request-controls.ps1') $directory
Copy-Item (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') $directory
function global:aws.exe {$global:LASTEXITCODE=0;if(($args -join ' ') -like 'sts get-caller-identity*'){return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}'};throw 'Unexpected AWS call'}
function global:node {$global:LASTEXITCODE=0;$command=$args -join ' ';if(($global:RequestRecoveryCase -eq 'probe' -and $command -like '*test-staging-request-controls.mjs*') -or ($global:RequestRecoveryCase -eq 'auth' -and $command -like '*run-disposable-staging-acceptance.mjs*') -or ($global:RequestRecoveryCase -eq 'logs' -and $command -like '*collect-staging-release-evidence.mjs*')){$global:LASTEXITCODE=1}}
try{
 @'
param($Mode)
$global:RequestRecoveryModes+=$Mode
if($global:RequestRecoveryCase -eq 'deploy' -and $Mode -eq 'enforce'){throw 'Synthetic deployment failure'}
'@ | Set-Content (Join-Path $directory 'deploy-staging-request-controls.ps1')
 foreach($case in @('success','probe','auth','logs','deploy')){
  $global:RequestRecoveryCase=$case;$global:RequestRecoveryModes=@();$failed=$false
  try{& (Join-Path $directory 'enforce-staging-request-controls.ps1') -ImageTag ('a'*40)}catch{$failed=$true}
  if($case -eq 'success'){if($failed -or $global:RequestRecoveryModes -contains 'count'){throw 'Valid enforcement was reverted'}}
  elseif(!$failed -or $global:RequestRecoveryModes[-1] -ne 'count'){throw 'Failed enforcement did not recover Count mode'}
 }
 Write-Host 'Five request-control recovery cases passed; no network calls.'
}finally{
 Remove-Item Function:/aws.exe,Function:/node
 $resolved=[IO.Path]::GetFullPath($directory)
 if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -notlike 'tp-request-recovery-test-*'){throw 'Temporary cleanup boundary failed'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}
