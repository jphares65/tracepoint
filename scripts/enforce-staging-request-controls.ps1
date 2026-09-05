[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ImageTag)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
$accepted=$false
function Invoke-NodeCheck([string[]]$Arguments){
 $previous=$ErrorActionPreference
 try{$ErrorActionPreference='Continue';& node @Arguments;$code=$LASTEXITCODE}finally{$ErrorActionPreference=$previous}
 if($code -ne 0){throw 'Live request-control acceptance failed after fixture cleanup'}
}
try{
 & (Join-Path $PSScriptRoot 'deploy-staging-request-controls.ps1') -Mode enforce
 Invoke-NodeCheck @((Join-Path $PSScriptRoot 'test-staging-request-controls.mjs'),'--execute','--mode','enforce')
 Invoke-NodeCheck @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--range-documents','--extended-workflows')
 Invoke-NodeCheck @((Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs'),'--image',$ImageTag)
 $accepted=$true
}finally{
 if(!$accepted){Assert-TracePointStagingIdentity | Out-Null;& (Join-Path $PSScriptRoot 'deploy-staging-request-controls.ps1') -Mode count}
}
