[CmdletBinding()]
param([string]$EvidenceOutputPath, [switch]$Wait)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$commit = (& git.exe -C $root rev-parse HEAD).Trim().ToLowerInvariant()
$branch = (& git.exe -C $root branch --show-current).Trim()
if ($commit -notmatch '^[0-9a-f]{40}$' -or $branch -ne 'codex/aws-main-integration-final-20260908') { throw 'The exact full-AWS integration branch is required.' }
if (@(& git.exe -C $root status --porcelain).Count) { throw 'Commit all identity migration source before publication.' }
$archive = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-identity-source-' + [guid]::NewGuid().ToString('N') + '.zip')
try {
    & git.exe -C $root archive --format=zip --output=$archive "--add-virtual-file=TRACEPOINT_SOURCE_COMMIT:$commit" $commit -- Dockerfile.identity-migration buildspec.identity-migration.yml package.json package-lock.json tsconfig.json src scripts/cognito-identity-batch-core.mjs scripts/cognito-identity-batch-core.test.mjs scripts/migrate-cognito-identities.mts scripts/prepare-cognito-identity-batch.mts scripts/run-cognito-identity-migration-task.mts
    if ($LASTEXITCODE -ne 0) { throw 'Identity migration source archive failed.' }
    $archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-TracePointStagingIdentity | Out-Null
    $sourceVersion = & aws.exe s3api put-object --bucket tracepoint-staging-build-source-559054714699 --key source/tracepoint-staging-source.zip --body $archive --region us-east-1 --query VersionId --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceVersion) -or $sourceVersion -eq 'None') { throw 'Versioned identity source upload failed.' }
    $tag = "$commit-identity-migration"
    $buildId = & aws.exe codebuild start-build --project-name tracepoint-staging-image-build --source-version $sourceVersion --buildspec-override buildspec.identity-migration.yml --environment-variables-override "name=IMAGE_TAG,value=$tag,type=PLAINTEXT" "name=SOURCE_COMMIT,value=$commit,type=PLAINTEXT" --region us-east-1 --query build.id --output text
    if ($LASTEXITCODE -ne 0 -or $buildId -notmatch '^tracepoint-staging-image-build:') { throw 'Identity migration image build failed to start.' }
    $evidence = [ordered]@{ format=1; account='559054714699'; region='us-east-1'; commit=$commit; imageTag=$tag; sourceVersion=$sourceVersion; sourceArchiveSha256=$archiveSha256; buildId=$buildId; buildStatus='IN_PROGRESS'; imageDigest=$null; scanStatus=$null; criticalFindings=$null; highFindings=$null }
    if ($Wait) {
        $deadline = [DateTime]::UtcNow.AddMinutes(45)
        do {
            $build = & aws.exe codebuild batch-get-builds --ids $buildId --region us-east-1 --output json | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0 -or $build.builds.Count -ne 1 -or $build.builds[0].sourceVersion -cne $sourceVersion) { throw 'Identity build provenance could not be verified.' }
            $status = $build.builds[0].buildStatus
            if ($status -eq 'SUCCEEDED') { break }
            if ($status -ne 'IN_PROGRESS') { throw "Identity build ended with $status." }
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Identity build monitoring timed out.' }
            Start-Sleep -Seconds 20
        } while ($true)
        & aws.exe ecr wait image-scan-complete --repository-name tracepoint-staging --image-id "imageTag=$tag" --region us-east-1
        if ($LASTEXITCODE -ne 0) { throw 'Identity image scan did not complete.' }
        $image = & aws.exe ecr describe-images --repository-name tracepoint-staging --image-ids "imageTag=$tag" --region us-east-1 --output json | ConvertFrom-Json
        $findings = $image.imageDetails[0].imageScanFindingsSummary.findingSeverityCounts
        if (($findings.CRITICAL ?? 0) -ne 0 -or ($findings.HIGH ?? 0) -ne 0) { throw 'Identity image has disallowed vulnerability findings.' }
        $evidence.buildStatus = 'SUCCEEDED'; $evidence.imageDigest = $image.imageDetails[0].imageDigest; $evidence.scanStatus = $image.imageDetails[0].imageScanStatus.status; $evidence.criticalFindings = ($findings.CRITICAL ?? 0); $evidence.highFindings = ($findings.HIGH ?? 0)
    }
    if ($EvidenceOutputPath) {
        $parent = Resolve-Path -LiteralPath (Split-Path -Parent $EvidenceOutputPath)
        [IO.File]::WriteAllText($parent.Path + [IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $EvidenceOutputPath), ($evidence | ConvertTo-Json -Depth 4) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    }
    $evidence | ConvertTo-Json -Compress
} finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
