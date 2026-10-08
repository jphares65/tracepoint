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
 if (($args -join ' ') -like 'ssm get-parameter*') { return (@{Parameter=@{Value=('{"expiresAfterUtc":"'+[DateTime]::UtcNow.AddDays(2).ToString("yyyy-MM-ddTHH:mm:ssZ")+'","leaseOwner":"github-release","leaseReference":"github:123:1"}')}} | ConvertTo-Json -Compress) }
 if (($args -join ' ') -like 'ecs list-tasks*') { return 'arn:aws:ecs:us-east-1:559054714699:task/tracepoint-staging/synthetic' }
 if (($args -join ' ') -like 'ecs describe-tasks*') { return '{"tasks":[{"containers":[{"imageDigest":"sha256:fadaab8088e37f4b3a3285eb773533d8d51d8dc091105a46e29f7309c63ff1ee"}]}]}' }
 if (($args -join ' ') -like 'ecs describe-services*') {return "arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:$global:ReleaseTestRevision"}
 if (($args -join ' ') -like 'ecs wait services-stable*') {return}
 throw 'Unexpected AWS call; real AWS is unavailable to this test.'
}
function global:node {
 $global:LASTEXITCODE=0
 $command=$args -join ' '
 $global:ReleaseTestCalls+= $command
 if($command -match 'validate-staging-database-release-lease\.mjs') {Write-Output ('{"expiresAfterUtc":"'+[DateTime]::UtcNow.AddDays(2).ToString("yyyy-MM-ddTHH:mm:ssZ")+'","leaseOwner":"github-release","leaseReference":"github:123:1"}');return}
 if($global:ReleaseTestScenario -eq 'stderr' -and $command -match 'rehearse-cognito') {Write-Error 'Synthetic child error before finally';$global:ReleaseTestCalls+='child-cleanup';$global:LASTEXITCODE=1;return}
 if (($global:ReleaseTestScenario -eq 'preflight' -and $command -match 'test-staging-native-login') -or
     ($global:ReleaseTestScenario -eq 'acceptance' -and $command -match 'rehearse-cognito') -or
     ($global:ReleaseTestScenario -eq 'brevo' -and $command -match 'test-staging-brevo-delivery') -or
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
if($WaitSeconds -ne 900){throw 'Each ALB convergence phase must start with a fresh bounded settling window'}
$global:ReleaseTestCalls+='runtime'
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'test-tracepoint-staging-runtime.ps1')
 @'
param($TaskDefinitionArn,[switch]$Execute)
if($TaskDefinitionArn -notmatch ':1$' -or !$Execute){throw 'Wrong rollback target'}
$global:ReleaseTestCalls+='rollback'
$global:ReleaseTestRevision=1
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'invoke-tracepoint-staging-rollback.ps1')
 foreach($scenario in @('success','preflight','acceptance','evidence','stderr','diagnostic')) {
  $global:ReleaseTestScenario=$scenario;$global:ReleaseTestRevision=1;$global:ReleaseTestCalls=@();$failed=$false
  try {& (Join-Path $temporaryRoot 'release-tracepoint-staging.ps1') -ImageTag (('a'*40)+'-aws-native-staging') -CertificateArn 'synthetic' -AuthenticationProvider cognito -AllowKnownStagingLoginDiagnostic:($scenario -eq 'diagnostic')} catch {$failed=$true}
  if($scenario -eq 'success') {
   if($failed -or $global:ReleaseTestRevision -ne 2 -or $global:ReleaseTestCalls -contains 'rollback'){throw 'Successful release incorrectly rolled back'}
   if(-not ($global:ReleaseTestCalls -match 'rehearse-cognito')){throw 'Successful release skipped real Cognito authentication rehearsal'}
   if($global:ReleaseTestCalls -match 'test-staging-brevo-delivery'){throw 'AWS-native release invoked the bridge-only Brevo delivery gate'}
  }
  elseif($scenario -eq 'preflight') {if(!$failed -or $global:ReleaseTestCalls -contains 'deploy'){throw 'Failed authentication preflight deployed'}}
  elseif($scenario -eq 'diagnostic') {
   if(!$failed -or $global:ReleaseTestRevision -ne 1 -or $global:ReleaseTestCalls -notcontains 'rollback'){throw 'One-shot diagnostic did not automatically restore the recovery task'}
   if(-not (($global:ReleaseTestCalls -join "`n") -match '--verify-mobile-bearer-only')){throw 'One-shot diagnostic skipped strict post-deploy mobile bearer verification'}
  }
  elseif(!$failed -or $global:ReleaseTestRevision -ne 1 -or $global:ReleaseTestCalls -notcontains 'rollback'){throw 'Failed release did not restore prior revision'}
  if($scenario -eq 'stderr' -and $global:ReleaseTestCalls -notcontains 'child-cleanup'){throw 'Native error interrupted child cleanup'}
 }
 $global:ReleaseTestScenario='success';$global:ReleaseTestRevision=1;$global:ReleaseTestCalls=@();$failed=$false
 try {& (Join-Path $temporaryRoot 'release-tracepoint-staging.ps1') -ImageTag (('a'*40)+'-aws-native-staging') -CertificateArn 'synthetic' -AuthenticationProvider bridge} catch {$failed=$true}
 if($failed -or -not (($global:ReleaseTestCalls -join "`n") -match 'test-staging-brevo-delivery')){throw 'Bridge release skipped live Brevo delivery'}
 Write-Host 'Passed native and bridge release orchestration cases: native success, preflight denial, acceptance rollback, evidence rollback, stderr cleanup, and bridge Brevo delivery. Zero network calls.'
} finally {
 Remove-Item Function:/aws.exe,Function:/node
 $resolved=[IO.Path]::GetFullPath($temporaryRoot)
 if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -notlike 'tracepoint-release-test-*'){throw 'Temporary cleanup boundary failed'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}

# Expected mock failures must not become the GitHub pwsh step exit code.
# This line is reached only when every assertion and cleanup succeeded.
$global:LASTEXITCODE=0
