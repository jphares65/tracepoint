[CmdletBinding()]
param([switch]$Execute)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$model=Get-Content (Join-Path $root 'docs/aws-staging-cost-model-20260904.json') -Raw | ConvertFrom-Json
$total=($model.componentsCents.PSObject.Properties.Value | Measure-Object -Sum).Sum
if($total+200 -gt 7500){throw 'SES foundation plus bounded rehearsal reserve exceeds staging ceiling'}
$infra=Join-Path $root 'infra'
$assembly=Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-ses-review-'+[guid]::NewGuid().ToString('N'))
$arguments=@('tracepoint-staging-ses-foundation','--app','npx ts-node bin/staging-ses-foundation.ts','-c','account=559054714699','-c','region=us-east-1','-c','providerActivation=disabled','--lookups=false','--output',$assembly)
Push-Location $infra
try {
 $ErrorActionPreference='Continue'
 & npx.cmd cdk synth @arguments --strict --quiet
 if($LASTEXITCODE -ne 0){throw 'SES strict synthesis failed'}
 & node (Join-Path $PSScriptRoot 'validate-disabled-ses-template.mjs') (Join-Path $assembly 'tracepoint-staging-ses-foundation.template.json')
 if($LASTEXITCODE -ne 0){throw 'SES disabled structural gate failed'}
 & npx.cmd cdk diff @arguments --no-change-set --fail=false
 if($LASTEXITCODE -ne 0){throw 'SES live diff failed'}
 if($Execute){
  Assert-TracePointStagingIdentity | Out-Null
  & npx.cmd cdk deploy @arguments --exclusively --require-approval never
  if($LASTEXITCODE -ne 0){throw 'SES foundation deployment failed'}
 }
}finally{Pop-Location}
