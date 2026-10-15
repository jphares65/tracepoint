Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$temporaryRoot=Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-release-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
$savedStepSummary=$env:GITHUB_STEP_SUMMARY
$savedRunId=$env:GITHUB_RUN_ID
$savedRunAttempt=$env:GITHUB_RUN_ATTEMPT
$env:GITHUB_STEP_SUMMARY=Join-Path $temporaryRoot 'test-summary.md'
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
 if($command -match '--range-documents' -and $global:ReleaseTestScenario -in @('acceptance','stderr','rollback_failure')) {Write-Output '{"acceptanceHarness":"failed","stage":"authenticated-acceptance","sensitiveDetailsPrinted":false}';if($global:ReleaseTestScenario -eq 'stderr'){Write-Error 'Synthetic child error before finally';$global:ReleaseTestCalls+='child-cleanup'};$global:LASTEXITCODE=1;return}
 if (($global:ReleaseTestScenario -eq 'preflight' -and $command -match '--fixtures-only') -or
     ($global:ReleaseTestScenario -eq 'acceptance' -and $command -match '--range-documents') -or
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
$global:ReleaseTestRuntimeWaits+= $WaitSeconds
if($WaitSeconds -ne 900){throw 'Baseline or rollout settling wait missing'}
$global:ReleaseTestCalls+='runtime'
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'test-tracepoint-staging-runtime.ps1')
 @'
param($TaskDefinitionArn,[switch]$Execute)
if($TaskDefinitionArn -notmatch ':1$' -or !$Execute){throw 'Wrong rollback target'}
$global:ReleaseTestCalls+='rollback'
if($global:ReleaseTestScenario -eq 'rollback_failure'){throw 'Synthetic rollback failure'}
$global:ReleaseTestRevision=1
'@ | Set-Content -LiteralPath (Join-Path $temporaryRoot 'invoke-tracepoint-staging-rollback.ps1')
 foreach($scenario in @('success','preflight','acceptance','brevo','evidence','stderr','rollback_failure')) {
  $global:ReleaseTestScenario=$scenario;$global:ReleaseTestRevision=1;$global:ReleaseTestCalls=@();$global:ReleaseTestRuntimeWaits=@();$failed=$false
  $resultPath=Join-Path $temporaryRoot ($scenario+'.json')
  $env:GITHUB_RUN_ID='release-test'
  $env:GITHUB_RUN_ATTEMPT=$scenario
  $captured=@()
  $caughtType='';$caughtId=''
  try {$captured=@(& (Join-Path $temporaryRoot 'release-tracepoint-staging.ps1') -ImageTag (('a'*40)+'-aws-native-staging') -CertificateArn 'synthetic' -ResultPath $resultPath)} catch {$failed=$true;$caughtType=$_.Exception.GetType().FullName;$caughtId=$_.FullyQualifiedErrorId}
  if(-not (Test-Path -LiteralPath $resultPath)){throw "Scenario $scenario did not retain a structured result (exception type $caughtType; error id $caughtId)."}
  $report=Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
  if($report.runId -ne ('release-test-'+$scenario)){throw 'Result run identity did not include the workflow attempt.'}
  if(($captured -join "`n") -match 'Synthetic child error before finally'){throw 'Raw subprocess output contaminated the release summary.'}
  if($scenario -eq 'success') {
   if($failed -or $global:ReleaseTestRevision -ne 2 -or $global:ReleaseTestCalls -contains 'rollback'){throw 'Successful release incorrectly rolled back'}
   if(-not ($global:ReleaseTestCalls -match 'test-staging-brevo-delivery')){throw 'Successful release skipped live Brevo delivery'}
   if($global:ReleaseTestRuntimeWaits.Count -ne 2 -or @($global:ReleaseTestRuntimeWaits | Where-Object {$_ -ne 900}).Count -ne 0){throw 'Baseline and post-deploy runtime checks must each allow 900 seconds.'}
   if($report.outcome -ne 'succeeded' -or $report.rollback.outcome -ne 'not_needed' -or $report.failure){throw 'Successful result has inconsistent outcome fields.'}
  }
  elseif($scenario -eq 'preflight') {if(!$failed -or $global:ReleaseTestCalls -contains 'deploy'){throw 'Failed authentication preflight deployed'};if($report.outcome -ne 'failed' -or $report.failure.phase -ne 'fixtures' -or $report.rollback.outcome -ne 'not_needed'){throw 'Preflight failure result lost its original phase or rollback state.'}}
  elseif($scenario -eq 'rollback_failure') {if(!$failed -or $global:ReleaseTestRevision -ne 2 -or $global:ReleaseTestCalls -notcontains 'rollback'){throw 'Injected rollback failure did not occur.'};if($report.outcome -ne 'failed' -or $report.rollback.outcome -ne 'failed' -or $report.failure.phase -ne 'acceptance' -or $report.failure.assertion -notmatch '^ACCEPTANCE_'){throw 'Rollback failure masked the original acceptance failure.'}}
  elseif(!$failed -or $global:ReleaseTestRevision -ne 1 -or $global:ReleaseTestCalls -notcontains 'rollback'){throw 'Failed release did not restore prior revision'}
  elseif($report.outcome -ne 'failed' -or $report.rollback.outcome -ne 'succeeded'){throw 'Successful rollback incorrectly converted the failed release to success.'}
  if($scenario -in @('acceptance','stderr','rollback_failure') -and ($report.failure.phase -ne 'acceptance' -or $report.failure.assertion -notmatch '^ACCEPTANCE_')){throw "Acceptance failure phase/assertion was not preserved: $($report.failure.phase) / $($report.failure.assertion)."}
  if($scenario -eq 'brevo' -and ($report.failure.phase -ne 'brevo' -or $report.failure.assertion -notmatch '^BREVO_')){throw 'Brevo failure phase/assertion was not preserved.'}
  if($scenario -eq 'evidence' -and ($report.failure.phase -ne 'evidence' -or $report.failure.assertion -ne 'RELEASE_EVIDENCE_GATE_FAILED')){throw 'Evidence failure phase/assertion was not preserved.'}
  if($scenario -eq 'stderr' -and $global:ReleaseTestCalls -notcontains 'child-cleanup'){throw 'Native error interrupted child cleanup'}
 }
 $scenarioReports=Get-ChildItem -LiteralPath $temporaryRoot -Filter '*.json' | ForEach-Object {Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json}
 if(@($scenarioReports.runId | Select-Object -Unique).Count -ne $scenarioReports.Count){throw 'Run-scoped results collided across attempts.'}
 $laterRunId='release-test-later-42'
 $laterResultPath=Join-Path $temporaryRoot 'later-workflow-failure.json'
 $laterResult=[ordered]@{schemaVersion=1;runId=$laterRunId;outcome='succeeded';phase='complete';imageTag=(('a'*40)+'-aws-native-staging');failure=$null;rollback=[ordered]@{outcome='not_needed';failure=$null}}
 [IO.File]::WriteAllText($laterResultPath,($laterResult|ConvertTo-Json -Depth 5),(New-Object System.Text.UTF8Encoding($false)))
 $successResultPath=Join-Path $temporaryRoot 'controlled-rollback-success.json'
 [IO.File]::WriteAllText($successResultPath,($laterResult|ConvertTo-Json -Depth 5),(New-Object System.Text.UTF8Encoding($false)))
 & (Join-Path $PSScriptRoot 'record-staging-controlled-rollback.ps1') -ResultPath $successResultPath -ExpectedRunId $laterRunId -Outcome succeeded
 $successResult=Get-Content -Raw -LiteralPath $successResultPath|ConvertFrom-Json
 if($successResult.outcome -ne 'succeeded' -or $successResult.releaseOutcome -ne 'succeeded' -or $successResult.controlledRollback.outcome -ne 'succeeded'){throw 'Successful controlled rollback was not recorded accurately.'}
 & (Join-Path $PSScriptRoot 'record-staging-controlled-rollback.ps1') -ResultPath $laterResultPath -ExpectedRunId $laterRunId -Outcome failed
 $laterReport=Get-Content -Raw -LiteralPath $laterResultPath|ConvertFrom-Json
 if($laterReport.outcome -ne 'failed' -or $laterReport.phase -ne 'failed' -or $laterReport.releaseOutcome -ne 'succeeded' -or $laterReport.failure -or $laterReport.rollback.outcome -ne 'not_needed' -or $laterReport.controlledRollback.outcome -ne 'failed'){throw 'A later workflow failure left stale success or overwrote the release/automatic-rollback result.'}
 $testSummary=Get-Content -Raw -LiteralPath $env:GITHUB_STEP_SUMMARY
 if($testSummary -notmatch 'Controlled staging rollback result' -or $testSummary -notmatch 'Overall run: \*\*failed\*\*'){throw 'The workflow summary retained a stale success after the later failure.'}
 $mismatchedRunRejected=$false
 try { & (Join-Path $PSScriptRoot 'record-staging-controlled-rollback.ps1') -ResultPath $laterResultPath -ExpectedRunId 'another-run-attempt' -Outcome succeeded } catch { $mismatchedRunRejected=$true }
 $afterMismatch=Get-Content -Raw -LiteralPath $laterResultPath|ConvertFrom-Json
 if(-not $mismatchedRunRejected -or $afterMismatch.outcome -ne 'failed' -or $afterMismatch.controlledRollback.outcome -ne 'failed'){throw 'A different run attempt changed this release result.'}
 $preservationPath=Join-Path $temporaryRoot 'original-failure-preserved.json'
 $originalFailure=[ordered]@{phase='acceptance';assertion='ACCEPTANCE_DOCUMENT_EVIDENCE_FAILED'}
 $preservationResult=[ordered]@{schemaVersion=1;runId=$laterRunId;outcome='failed';phase='failed';imageTag=(('b'*40)+'-aws-native-staging');failure=$originalFailure;rollback=[ordered]@{outcome='succeeded';failure=$null}}
 [IO.File]::WriteAllText($preservationPath,($preservationResult|ConvertTo-Json -Depth 5),(New-Object System.Text.UTF8Encoding($false)))
 & (Join-Path $PSScriptRoot 'record-staging-controlled-rollback.ps1') -ResultPath $preservationPath -ExpectedRunId $laterRunId -Outcome failed
 $preservedReport=Get-Content -Raw -LiteralPath $preservationPath|ConvertFrom-Json
 if($preservedReport.failure.phase -ne 'acceptance' -or $preservedReport.failure.assertion -ne 'ACCEPTANCE_DOCUMENT_EVIDENCE_FAILED' -or $preservedReport.rollback.outcome -ne 'succeeded' -or $preservedReport.controlledRollback.outcome -ne 'failed'){throw 'Controlled rollback reporting overwrote the original failure or automatic rollback state.'}
 $invalidSummaryPath=Join-Path $temporaryRoot 'invalid-summary.json'
 [IO.File]::WriteAllText($invalidSummaryPath,($laterResult|ConvertTo-Json -Depth 5),(New-Object System.Text.UTF8Encoding($false)))
 $validSummaryPath=$env:GITHUB_STEP_SUMMARY
 $env:GITHUB_STEP_SUMMARY=$temporaryRoot
 $reportingFailed=$false
 try { & (Join-Path $PSScriptRoot 'record-staging-controlled-rollback.ps1') -ResultPath $invalidSummaryPath -ExpectedRunId $laterRunId -Outcome succeeded } catch { $reportingFailed=$true }
 $env:GITHUB_STEP_SUMMARY=$validSummaryPath
 $invalidSummaryReport=Get-Content -Raw -LiteralPath $invalidSummaryPath|ConvertFrom-Json
 if(-not $reportingFailed -or $invalidSummaryReport.outcome -ne 'succeeded' -or $invalidSummaryReport.releaseOutcome -ne 'succeeded' -or $invalidSummaryReport.controlledRollback.outcome -ne 'succeeded' -or $invalidSummaryReport.diagnosticsError.assertion -ne 'GITHUB_STEP_SUMMARY_WRITE_FAILED'){throw 'Summary reporting failure changed a known successful rollback outcome or failed to record diagnostics.'}
 Write-Host 'Passed seven release orchestration cases plus controlled-rollback success/failure, run identity isolation, original-failure preservation, and invalid-summary diagnostics with preserved rollback success. Zero network calls.'
} finally {
 Remove-Item Function:/aws.exe,Function:/node
 if($null -eq $savedStepSummary){Remove-Item Env:GITHUB_STEP_SUMMARY -ErrorAction SilentlyContinue}else{$env:GITHUB_STEP_SUMMARY=$savedStepSummary}
 if($null -eq $savedRunId){Remove-Item Env:GITHUB_RUN_ID -ErrorAction SilentlyContinue}else{$env:GITHUB_RUN_ID=$savedRunId}
 if($null -eq $savedRunAttempt){Remove-Item Env:GITHUB_RUN_ATTEMPT -ErrorAction SilentlyContinue}else{$env:GITHUB_RUN_ATTEMPT=$savedRunAttempt}
 $resolved=[IO.Path]::GetFullPath($temporaryRoot)
 if([IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -notlike 'tracepoint-release-test-*'){throw 'Temporary cleanup boundary failed'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
}

# Expected mock failures must not become the GitHub pwsh step exit code.
# This line is reached only when every assertion and cleanup succeeded.
$global:LASTEXITCODE=0
