[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ResultPath,
    [Parameter(Mandatory)][string]$ExpectedRunId,
    [Parameter(Mandatory)][ValidateSet('succeeded','failed')][string]$Outcome
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$fullPath = [IO.Path]::GetFullPath($ResultPath)
if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw 'Run-scoped release result is missing.' }
$report = Get-Content -Raw -LiteralPath $fullPath | ConvertFrom-Json
if ($report.schemaVersion -ne 1 -or [string]$report.runId -cne $ExpectedRunId) { throw 'Run-scoped release result identity mismatch.' }
if (-not $report.PSObject.Properties['releaseOutcome']) { $report | Add-Member -NotePropertyName releaseOutcome -NotePropertyValue $report.outcome }
if ($Outcome -eq 'failed') {
    $report.outcome = 'failed'
    $report.phase = 'failed'
    $controlledRollback = [ordered]@{
        outcome = 'failed'
        failure = [ordered]@{ phase = 'controlled_rollback'; assertion = 'CONTROLLED_STAGING_ROLLBACK_FAILED' }
    }
} else {
    $controlledRollback = [ordered]@{ outcome = 'succeeded'; failure = $null }
}
if ($report.PSObject.Properties['controlledRollback']) { $report.controlledRollback = $controlledRollback }
else { $report | Add-Member -NotePropertyName controlledRollback -NotePropertyValue $controlledRollback }
[IO.File]::WriteAllText($fullPath, ($report | ConvertTo-Json -Depth 6) + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_STEP_SUMMARY)) {
    $summary = @('## Controlled staging rollback result', '', ('- Run: `' + $ExpectedRunId + '`'), ('- Rollback: **' + $Outcome + '**'), ('- Overall run: **' + $report.outcome + '**'))
    try {
        [IO.File]::AppendAllText($env:GITHUB_STEP_SUMMARY, ($summary -join [Environment]::NewLine) + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        $diagnostics = [ordered]@{ phase = 'controlled_rollback_reporting'; assertion = 'GITHUB_STEP_SUMMARY_WRITE_FAILED' }
        if ($report.PSObject.Properties['diagnosticsError']) { $report.diagnosticsError = $diagnostics }
        else { $report | Add-Member -NotePropertyName diagnosticsError -NotePropertyValue $diagnostics }
        [IO.File]::WriteAllText($fullPath, ($report | ConvertTo-Json -Depth 6) + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
        throw 'Rollback outcome was recorded, but the workflow summary could not be updated.'
    }
}
