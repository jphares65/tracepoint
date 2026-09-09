[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('logging','count','enforce')][string]$Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cost=Get-Content (Join-Path $root 'docs/aws-cost-evidence-20260905.json') -Raw | ConvertFrom-Json
$additionalReserve=12
if($cost.PSObject.Properties['requestControlsModeledUSD']){$additionalReserve-= [double]$cost.requestControlsModeledUSD}
if($cost.account -ne '559054714699' -or $additionalReserve -lt 2 -or $cost.modeledMonthlyUSD+$additionalReserve -ge 75){throw 'WAF plus disposable database reserve exceeds ceiling'}
$alb='arn:aws:elasticloadbalancing:us-east-1:559054714699:loadbalancer/app/tracep-Servi-G9c0RkjQMCj4/af079dabc04bbb9c'
$association=& aws.exe wafv2 get-web-acl-for-resource --resource-arn $alb --region us-east-1 --output json
if($LASTEXITCODE -ne 0){throw 'Cannot verify current ALB protection'}
$current=$association|ConvertFrom-Json
if($current.PSObject.Properties['WebACL'] -and $current.WebACL.Name -ne 'tracepoint-staging-requests'){throw 'Existing unrelated WAF cannot be replaced'}
if($Mode -ne 'logging'){
 $previousMode=if($Mode -eq 'count'){'logging'}else{'count'}
 $proof=Get-Content (Join-Path $root "docs/aws-request-controls-$previousMode-20260905.json") -Raw|ConvertFrom-Json
 $age=([datetime]::UtcNow-[datetime]$proof.completedAt).TotalHours
 if($proof.account -ne '559054714699' -or $proof.region -ne 'us-east-1' -or $proof.mode -ne $previousMode -or $proof.origin -ne 'https://staging.tracepointhq.com' -or !$proof.loggingRedactionVerified -or !$proof.normalRoutesHealthy -or $age -lt 0 -or $age -gt 24){throw 'Recent live logging/count proof is required'}
 if($Mode -eq 'enforce' -and (!$proof.probeAllowed -or $proof.countedRequests -le 0 -or $proof.globalRateMatches -ne 0)){throw 'Count-mode threshold proof is missing or caught legitimate traffic'}
}
$assembly=Join-Path ([IO.Path]::GetTempPath()) ('tp-waf-assembly-'+[guid]::NewGuid().ToString('N'))
$context=@('--app','npx ts-node bin/staging-request-controls.ts','--output',$assembly,'-c','account=559054714699','-c','region=us-east-1','-c',"loadBalancerArn=$alb",'-c',"mode=$Mode")
Push-Location (Join-Path $root 'infra')
try{
 $ErrorActionPreference='Continue'
 & npx.cmd cdk synth --strict @context
 if($LASTEXITCODE -ne 0){throw 'Strict request-control synthesis failed'}
 $template=Join-Path $assembly 'tracepoint-staging-request-controls.template.json'
 $prior=Join-Path $assembly 'prior.json'
 if($current.PSObject.Properties['WebACL']){
  & aws.exe cloudformation get-template --stack-name tracepoint-staging-request-controls --region us-east-1 --output json > $prior
  if($LASTEXITCODE -ne 0){throw 'Existing WAF ownership/template unavailable'}
  & node (Join-Path $PSScriptRoot 'validate-request-controls-deployment.mjs') $template $prior
 }else{& node (Join-Path $PSScriptRoot 'validate-request-controls-deployment.mjs') $template}
 if($LASTEXITCODE -ne 0){throw 'Request-control structural gate failed'}
 & npx.cmd cdk diff --app $assembly --no-change-set
 if($LASTEXITCODE -ne 0){throw 'Live request-control diff failed'}
 Assert-TracePointStagingIdentity | Out-Null
 & npx.cmd cdk deploy --app $assembly --exclusively --require-approval never --progress events
 if($LASTEXITCODE -ne 0){throw 'Request-control deployment failed'}
}finally{Pop-Location;$ErrorActionPreference='Stop'}
