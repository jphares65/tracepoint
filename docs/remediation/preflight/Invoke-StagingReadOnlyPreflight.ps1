[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory, Position = 0)][string]$Environment,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ReleaseCommit,
    [ValidateSet('before', 'after')][string]$Phase = 'before',
    [switch]$Plan,
    [switch]$SelfTest,
    [switch]$RunMigrateDbStatus,
    [string]$EvidenceRoot
)

# Read-only staging preflight (README.md in this folder). Run from the repository
# root on the operator workstation after `aws sso login --profile
# tracepoint-member-staging`. AWS access is describe/get/list only, plus
# `ecs run-task` of an already registered migration-runner revision with a
# command override that runs the committed SQL kit in read-only transactions.
# It never changes the ECS service, task definitions, images, platform stacks,
# notification delivery or the schema ledger.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($WhatIfPreference) { $Plan = [switch]$true }

if ($Environment -ne 'staging') { throw "Refusing environment '$Environment': this procedure is staging-only." }

$cfg = [ordered]@{
    Account = '559054714699'; Profile = 'tracepoint-member-staging'; Role = 'TracePointMigrationStaging'; Region = 'us-east-1'
    Cluster = 'tracepoint-staging'; Service = 'tracepoint-staging'; Repository = 'tracepoint-staging'
    RunnerFamily = 'tracepoint-staging-database-bootstrap'
    MigratorSecretArn = 'arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/database/migrator-GqXXWG'
    DbInstance = 'tracepoint-staging-full-aws'; ExpectedEngine = '18.4'
    IntegrationRef = 'origin/claude/integration-defects-20261020'
    KitPath = 'docs/remediation/preflight/staging-preflight-readonly.sql'
    KitSha256 = '78a2cc90865ec29c0ecdbf4d5ce41feeec355df824ad29fd2040ad2cef9d6eb3'
    OverridesLimit = 8192; OverridesBudget = 7680
}
$productionAccounts = @('193644343389')
$expectedApplied = 1..37
$expectedPending = @(38, 39, 40, 41, 42, 43, 44, 45, 46, 48, 49, 50, 51, 52, 53)

# >>> FORBIDDEN-VERB ALLOW-LIST
# The only region the self-check skips. It holds data, not calls.
$ForbiddenPatterns = @('update-service', 'register-task-definition', '\bcreate-[a-z]', '\bput-[a-z]', '\bdelete-[a-z]', '\bcdk\b', 'cloudformation', '\biam\b', '(?<![\w-])apply(?![\w-])', 'start-build', 'codebuild', 's3api')
$AllowedAwsCalls = @(
    'sts get-caller-identity', 'configure get',
    'ecs describe-services', 'ecs describe-task-definition', 'ecs list-task-definitions', 'ecs list-tasks', 'ecs describe-tasks', 'ecs run-task', 'ecs wait',
    'ecr describe-images', 'rds describe-db-instances', 'rds describe-db-snapshots', 'logs filter-log-events',
    'scheduler list-schedules', 'events list-rules', 'events list-targets-by-rule', 'events list-api-destinations', 'sesv2 get-account'
)
# Kit chunks: a chunk starts at its marker line and ends before the next one.
# A chunk whose run-task overrides exceed the budget is split again at the
# "\echo '-- X" line nearest its middle.
$ChunkMarkers = @(
    @{ Id = 'SESSION'; Marker = $null },
    @{ Id = 'G2'; Marker = "\echo '==== G2 ledger" },
    @{ Id = 'G3'; Marker = "\echo '==== G3 hard" },
    @{ Id = 'G4a'; Marker = "\echo '==== G4 data-impact" },
    @{ Id = 'G4b'; Marker = "\echo '-- G4b equipment" },
    @{ Id = 'G4c'; Marker = "\echo '-- G4c " },
    @{ Id = 'G4d'; Marker = "\echo '-- G4d " },
    @{ Id = 'G4e'; Marker = "\echo '-- G4e B7" },
    @{ Id = 'G4f'; Marker = "\echo '-- G4f DC2 R0" },
    @{ Id = 'G4g'; Marker = "\echo '-- G4g " },
    @{ Id = 'A'; Marker = "\echo '==== AFTER apply" }
)

# Self-test samples (must be detected / refused).
$ForbiddenSamples = @('aws ecs update-service --cluster x', 'aws ecs register-task-definition', 'aws s3api put-object', 'npx cdk deploy', 'aws iam get-role', 'aws cloudformation describe-stacks', 'aws rds delete-db-snapshot', 'aws rds create-db-snapshot', 'migrate-db.ps1 staging -Action apply')
$RefusedCallSamples = @(@('ecs', 'update-service'), @('ecs', 'register-task-definition'), @('rds', 'create-db-snapshot'), @('ecr', 'put-image'), @('logs', 'delete-log-stream'))
$RegionMarkers = @('# >>> FORBIDDEN-VERB ALLOW-LIST', '# <<< FORBIDDEN-VERB ALLOW-LIST')
$RegionSample = @('# >>> FORBIDDEN-VERB ALLOW-LIST', 'update-service', '# <<< FORBIDDEN-VERB ALLOW-LIST', 'aws ecs describe-services')
# <<< FORBIDDEN-VERB ALLOW-LIST

# Runs inside the task as `node -e <boot>`; the image already contains pg and
# the RDS CA. It verifies the chunk sha256, refuses anything but SELECT/WITH,
# connects with default_transaction_read_only=on, wraps the chunk in one
# `begin transaction read only` ... `rollback` (each statement under a
# savepoint so one error does not hide the rest) and fails hard unless
# transaction_read_only is 'on'. The kit's own begin/rollback lines are skipped.
$RunnerJs = @'
const z=require('zlib'),c=require('crypto'),f=require('fs'),{Client}=require('pg'),E=process.env;let q=0,x=0;
const o=(t,v)=>{const s=JSON.stringify({t,...v}),n=q++,p=Math.ceil(s.length/4000)||1;for(let i=0;i<p;i++)console.log('TPPF '+E.TP_PF_ID+' '+n+' '+i+' '+p+' '+s.slice(i*4000,i*4000+4000))};
function P(t){const r=[];let i=0,b='',k='',L=t.length;while(i<L){const h=t[i];
if(!k&&h==='\\'&&(i===0||t[i-1]==='\n')){let j=t.indexOf('\n',i);if(j<0)j=L;const l=t.slice(i,j),m=/^\\echo '(.*)'$/.exec(l);if(m)r.push({e:m[1].replace(/''/g,"'")});else if(!/^\\pset /.test(l))throw Error('meta '+l);i=j+1;b='';continue}
if(h==='-'&&t[i+1]==='-'){let j=t.indexOf('\n',i);if(j<0)j=L;b+=t.slice(i,j);i=j;continue}
if(h==='/'&&t[i+1]==='*'){let j=t.indexOf('*/',i+2);j=j<0?L:j+2;b+=t.slice(i,j);i=j;continue}
if(!k&&/[A-Za-z]/.test(h))k=/^[A-Za-z]+/.exec(t.slice(i))[0].toLowerCase();
if(h==="'"||h==='"'){let j=i+1;for(;j<L;j++)if(t[j]===h){if(t[j+1]===h){j++;continue}break}if(j>=L)throw Error('open quote');b+=t.slice(i,j+1);i=j+1;continue}
const d=h==='$'&&/^\$[A-Za-z_]*\$/.exec(t.slice(i,i+64));if(d){const j=t.indexOf(d[0],i+d[0].length);if(j<0)throw Error('open dollar');b+=t.slice(i,j+d[0].length);i=j+d[0].length;continue}
if(h===';'){const s=b.replace(/--[^\n]*/g,'').trim();if(/^begin\s+transaction\s+read\s+only$|^rollback$/i.test(s));else if(k==='select'||k==='with')r.push({k,s:b});else throw Error('refused statement: '+k);b='';k='';i++;continue}
b+=h;i++}if(k)throw Error('unterminated statement');return r}
(async()=>{let C;try{const B=z.gunzipSync(Buffer.from(E.TP_PF_SQL,'base64')),H=c.createHash('sha256').update(B).digest('hex');
if(H!==E.TP_PF_SHA)throw Error('chunk sha256 '+H);const S=P(B.toString('utf8')),J=JSON.parse(E.TRACEPOINT_DATABASE_SECRET_JSON);
if(E.CONFIGURATION_ENVIRONMENT!=='staging'||J.dbname!=='tracepoint'||J.port!==5432)throw Error('target');
C=new Client({host:J.host,port:J.port,user:J.username,password:J.password,database:J.dbname,ssl:{ca:f.readFileSync(E.TRACEPOINT_DATABASE_CA_PATH,'utf8'),rejectUnauthorized:true,servername:J.host},options:'-c default_transaction_read_only=on',connectionTimeoutMillis:1e4,statement_timeout:12e4,application_name:'tracepoint-readonly-preflight'});
await C.connect();const g=async n=>(await C.query('show '+n)).rows[0][n];if(await g('default_transaction_read_only')!=='on')throw Error('default_transaction_read_only');
await C.query('begin transaction read only');if(await g('transaction_read_only')!=='on')throw Error('transaction_read_only');
o('session',{sha256:H,statements:S.filter(s=>s.s).length,...(await C.query('select current_user cu,session_user su,current_database() db,current_setting(\'server_version\') sv,current_setting(\'transaction_read_only\') ro,current_setting(\'default_transaction_read_only\') dro,now() at')).rows[0]});
let n=0;for(const s of S){if(!s.s){o('echo',{text:s.e});continue}n++;await C.query('savepoint p');
try{const R=await C.query({text:s.s,rowMode:'array'});o('rows',{n,fields:R.fields.map(v=>v.name),rows:R.rows});await C.query('release savepoint p')}
catch(e){x++;o('error',{n,code:e.code,message:e.message});await C.query('rollback to savepoint p')}}
if(await g('transaction_read_only')!=='on')throw Error('transaction_read_only end');await C.query('rollback');o('done',{statements:n,errors:x})}
catch(e){o('fatal',{message:String(e&&e.message||e)});process.exitCode=1}finally{if(C)await C.end().catch(()=>0)}})()
'@
$RunnerBoot = "eval(require('zlib').gunzipSync(Buffer.from(process.env.TP_PF_JS,'base64'))+'')"

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $root 'scripts/migrate-db.ps1'))) { throw 'Run this from a TracePoint checkout (scripts/migrate-db.ps1 not found).' }
$script:Git = (Get-Command git.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($null -eq $script:Git) { $script:Git = Get-Command git -ErrorAction Stop | Select-Object -First 1 }
$script:Git = $script:Git.Source
$script:AwsCli = $null
$script:AwsLog = [System.Collections.Generic.List[string]]::new()

# ---------------------------------------------------------------- helpers
function Get-Prop($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -eq $p) { return $null }
    return $p.Value
}
function Get-Sha256Hex([byte[]]$Bytes) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (($h.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}
function Get-GitBlobId([byte[]]$Bytes) {
    $header = [Text.Encoding]::ASCII.GetBytes("blob $($Bytes.Length)`0")
    $all = New-Object byte[] ($header.Length + $Bytes.Length)
    [Array]::Copy($header, 0, $all, 0, $header.Length); [Array]::Copy($Bytes, 0, $all, $header.Length, $Bytes.Length)
    $h = [Security.Cryptography.SHA1]::Create()
    try { return (($h.ComputeHash($all) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}
function ConvertTo-GzipBase64([byte[]]$Bytes) {
    $ms = [IO.MemoryStream]::new()
    $gz = [IO.Compression.GZipStream]::new($ms, [IO.Compression.CompressionLevel]::Optimal)
    $gz.Write($Bytes, 0, $Bytes.Length); $gz.Dispose()
    return [Convert]::ToBase64String($ms.ToArray())
}
function ConvertFrom-GzipBase64([string]$Text) {
    $in = [IO.MemoryStream]::new([Convert]::FromBase64String($Text)); $out = [IO.MemoryStream]::new()
    $gz = [IO.Compression.GZipStream]::new($in, [IO.Compression.CompressionMode]::Decompress)
    $gz.CopyTo($out); $gz.Dispose()
    return , $out.ToArray()
}
# Deterministic JSON string encoding (Windows PowerShell's ConvertTo-Json
# escapes quotes and angle brackets, which would distort the size check).
function ConvertTo-JsonString([string]$Value) {
    $sb = [Text.StringBuilder]::new($Value.Length + 16)
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq [char]'"') { [void]$sb.Append('\"') }
        elseif ($ch -eq [char]'\') { [void]$sb.Append('\\') }
        elseif ($code -lt 0x20) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}
function Invoke-GitText([string[]]$Arguments) {
    $out = & $script:Git -C $root @Arguments 2>&1
    $code = $LASTEXITCODE
    return [pscustomobject]@{ Code = $code; Lines = @($out | ForEach-Object { [string]$_ }) }
}
# Exact committed bytes (no console decoding, no line-ending conversion).
function Get-GitBlobBytes([string]$Spec) {
    $psi = [Diagnostics.ProcessStartInfo]::new($script:Git)
    $psi.Arguments = "-C `"$root`" cat-file blob `"$Spec`""
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $err = $p.StandardError.ReadToEndAsync()
    $ms = [IO.MemoryStream]::new(); $p.StandardOutput.BaseStream.CopyTo($ms); $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw "git cat-file blob $Spec failed: $($err.Result)" }
    return , $ms.ToArray()
}

# ---------------------------------------------------------------- self-check
function Get-ForbiddenVerbHits([string[]]$Lines) {
    $hits = [System.Collections.Generic.List[string]]::new()
    $inside = $false; $regions = 0
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        $line = $Lines[$i]
        if ($line -match '^\s*# >>> FORBIDDEN-VERB ALLOW-LIST\s*$') { $inside = $true; $regions++; continue }
        if ($line -match '^\s*# <<< FORBIDDEN-VERB ALLOW-LIST\s*$') { $inside = $false; continue }
        if ($inside) { continue }
        foreach ($pattern in $ForbiddenPatterns) {
            if ($line -match "(?i)$pattern") { $hits.Add("line $($i + 1): '$pattern' in: $($line.Trim())") }
        }
    }
    if ($regions -ne 1 -or $inside) { $hits.Add("allow-list region markers are not exactly one closed region ($regions)") }
    return , $hits
}
function Assert-SelfScan {
    $hits = Get-ForbiddenVerbHits ([IO.File]::ReadAllLines($PSCommandPath))
    if ($hits.Count -ne 0) { throw "Forbidden-verb self-check failed:`n$($hits -join "`n")" }
    Write-Host "Self-check: no forbidden verb outside the allow-list ($($ForbiddenPatterns.Count) patterns)."
}

# ---------------------------------------------------------------- git / kit / release
function Get-RepositoryState {
    $head = (Invoke-GitText @('rev-parse', 'HEAD'))
    if ($head.Code -ne 0 -or $head.Lines[0].Trim() -notmatch '^[0-9a-f]{40}$') { throw 'Unable to resolve HEAD.' }
    $status = Invoke-GitText @('status', '--porcelain', '--untracked-files=all')
    if ($status.Code -ne 0) { throw 'git status failed.' }
    $branch = (Invoke-GitText @('rev-parse', '--abbrev-ref', 'HEAD')).Lines[0].Trim()
    return [pscustomobject]@{ Head = $head.Lines[0].Trim().ToLowerInvariant(); Branch = $branch; Dirty = @($status.Lines | Where-Object { $_ }) }
}
function Get-Kit([string]$Head) {
    $bytes = Get-GitBlobBytes "${Head}:$($cfg.KitPath)"
    $sha = Get-Sha256Hex $bytes
    if ($sha -ne $cfg.KitSha256) { throw "Committed kit sha256 $sha does not match the pinned $($cfg.KitSha256)." }
    $blob = (Invoke-GitText @('rev-parse', "${Head}:$($cfg.KitPath)")).Lines[0].Trim()
    if ((Get-GitBlobId $bytes) -ne $blob) { throw 'Kit bytes do not reproduce the committed blob id.' }
    return [pscustomobject]@{ Bytes = $bytes; Sha256 = $sha; Text = [Text.Encoding]::UTF8.GetString($bytes) }
}
function Get-ReleaseExpectation([string]$Commit, [switch]$SkipAncestry) {
    if ((Invoke-GitText @('cat-file', '-e', "$Commit^{commit}")).Code -ne 0) { throw "Release commit $Commit is not in the local repository (git fetch origin first)." }
    $onIntegration = (Invoke-GitText @('merge-base', '--is-ancestor', $Commit, $cfg.IntegrationRef)).Code -eq 0
    if (-not $onIntegration -and -not $SkipAncestry) { throw "Release commit $Commit is not on $($cfg.IntegrationRef) (git fetch origin, or use a merged release commit)." }
    $names = (Invoke-GitText @('ls-tree', '--name-only', $Commit, 'database/aws/')).Lines | Where-Object { $_ -match '^database/aws/\d{3}_[a-z0-9_]+\.sql$' } | Sort-Object
    $files = foreach ($name in $names) {
        $bytes = Get-GitBlobBytes "${Commit}:$name"
        $leaf = $name.Substring('database/aws/'.Length)
        [pscustomobject]@{ version = [int]$leaf.Substring(0, 3); filename = $leaf; sha256 = (Get-Sha256Hex $bytes); text = [Text.Encoding]::UTF8.GetString($bytes) }
    }
    $files = @($files)
    $versions = @($files | ForEach-Object { $_.version })
    $later = @($versions | Where-Object { $_ -gt 37 })
    if (($later -join ',') -ne ($expectedPending -join ',')) { throw "Release commit migration set after 037 is [$($later -join ',')]; this procedure covers exactly 038-046,048-053." }
    $f053 = $files | Where-Object { $_.version -eq 53 }
    $revokesFirearmHistory = $f053.text -match '(?is)revoke\s+insert[^;]*\bon\s+public\.firearm_status_history\b'
    return [pscustomobject]@{
        Commit = $Commit; OnIntegrationBranch = $onIntegration
        Variant = $(if ($revokesFirearmHistory) { 'contract (053 revokes firearm_status_history writes)' } else { 'expand (053 keeps the 037 firearm_status_history grants)' })
        Revokes053FirearmHistory = [bool]$revokesFirearmHistory
        Files = @($files | Select-Object -Property @('version', 'filename', 'sha256'))
    }
}

# ---------------------------------------------------------------- chunks
function Get-KitChunks([string]$Text, [string]$ContainerName, [int]$Budget) {
    $starts = [System.Collections.Generic.List[int]]::new(); $starts.Add(0)
    for ($i = $Text.IndexOf("`n"); $i -ge 0 -and $i -lt $Text.Length - 1; $i = $Text.IndexOf("`n", $i + 1)) { $starts.Add($i + 1) }
    $bounds = foreach ($m in $ChunkMarkers) {
        if ($null -eq $m.Marker) { @{ Id = $m.Id; Start = 0 }; continue }
        $found = @($starts | Where-Object { [string]::CompareOrdinal($Text, $_, $m.Marker, 0, $m.Marker.Length) -eq 0 })
        if ($found.Count -ne 1) { throw "Kit marker for $($m.Id) found $($found.Count) times." }
        @{ Id = $m.Id; Start = $found[0] }
    }
    $bounds = @($bounds)
    for ($i = 1; $i -lt $bounds.Count; $i++) { if ($bounds[$i].Start -le $bounds[$i - 1].Start) { throw 'Kit markers are out of order.' } }
    $chunks = [System.Collections.Generic.List[object]]::new()
    for ($i = 0; $i -lt $bounds.Count; $i++) {
        $end = $(if ($i + 1 -lt $bounds.Count) { $bounds[$i + 1].Start } else { $Text.Length })
        foreach ($c in (Split-KitChunk $Text $starts $bounds[$i].Id $bounds[$i].Start $end $ContainerName $Budget)) { $chunks.Add($c) }
    }
    return , $chunks
}
function New-KitChunk([string]$Text, $Lines, [string]$Id, [int]$Start, [int]$End, [string]$ContainerName) {
    $body = $Text.Substring($Start, $End - $Start)
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $sha = Get-Sha256Hex $bytes
    $gz = ConvertTo-GzipBase64 $bytes
    $overrides = New-ChunkOverrides $ContainerName $Id $sha $gz
    $firstLine = 1 + @($Lines | Where-Object { $_ -lt $Start }).Count
    $lastLine = @($Lines | Where-Object { $_ -lt $End }).Count
    return [pscustomobject]@{ Id = $Id; Start = $Start; End = $End; FirstLine = $firstLine; LastLine = $lastLine; Bytes = $bytes.Length; Sha256 = $sha; GzipBase64 = $gz; Overrides = $overrides; OverridesBytes = [Text.Encoding]::UTF8.GetByteCount($overrides) }
}
function Split-KitChunk([string]$Text, $Lines, [string]$Id, [int]$Start, [int]$End, [string]$ContainerName, [int]$Budget) {
    $chunk = New-KitChunk $Text $Lines $Id $Start $End $ContainerName
    if ($chunk.OverridesBytes -le $Budget) { return , @($chunk) }
    $mid = $Start + [int](($End - $Start) / 2)
    $candidates = @($Lines | Where-Object { $_ -gt $Start -and $_ -lt $End -and $Text.Substring($_, [Math]::Min(12, $Text.Length - $_)) -cmatch "^\\echo '-- [A-Z]" })
    if ($candidates.Count -eq 0) { throw "Chunk $Id needs $($chunk.OverridesBytes) override bytes (budget $Budget) and has no split point." }
    $cut = ($candidates | Sort-Object { [Math]::Abs($_ - $mid) } | Select-Object -First 1)
    $left = Split-KitChunk $Text $Lines "$Id-1" $Start $cut $ContainerName $Budget
    $right = Split-KitChunk $Text $Lines "$Id-2" $cut $End $ContainerName $Budget
    return , (@($left) + @($right))
}
function New-ChunkOverrides([string]$ContainerName, [string]$Id, [string]$Sha, [string]$GzipBase64) {
    $js = ConvertTo-GzipBase64 ([Text.Encoding]::UTF8.GetBytes($RunnerJs))
    $env = @(
        '{"name":"TP_PF_ID","value":' + (ConvertTo-JsonString $Id) + '}',
        '{"name":"TP_PF_SHA","value":' + (ConvertTo-JsonString $Sha) + '}',
        '{"name":"TP_PF_JS","value":' + (ConvertTo-JsonString $js) + '}',
        '{"name":"TP_PF_SQL","value":' + (ConvertTo-JsonString $GzipBase64) + '}'
    ) -join ','
    return '{"containerOverrides":[{"name":' + (ConvertTo-JsonString $ContainerName) + ',"command":["-e",' + (ConvertTo-JsonString $RunnerBoot) + '],"environment":[' + $env + ']}]}'
}
function Assert-Chunks($Kit, $Chunks) {
    $joined = ($Chunks | ForEach-Object { $Kit.Text.Substring($_.Start, $_.End - $_.Start) }) -join ''
    if ((Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($joined))) -ne $Kit.Sha256) { throw 'Chunks do not reassemble to the committed kit.' }
    foreach ($c in $Chunks) {
        if ((Get-Sha256Hex (ConvertFrom-GzipBase64 $c.GzipBase64)) -ne $c.Sha256) { throw "Chunk $($c.Id) gzip round trip does not match its sha256." }
        if ($c.Sha256 -ne (Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($Kit.Text.Substring($c.Start, $c.End - $c.Start))))) { throw "Chunk $($c.Id) is not a slice of the committed kit." }
        if ($c.OverridesBytes -gt $cfg.OverridesBudget -or $c.OverridesBytes -gt $cfg.OverridesLimit) { throw "Chunk $($c.Id) overrides are $($c.OverridesBytes) bytes." }
    }
    if (@($Chunks | Group-Object Id | Where-Object Count -gt 1).Count) { throw 'Duplicate chunk ids.' }
}

# ---------------------------------------------------------------- AWS (guarded)
function Resolve-AwsCli {
    $cmd = Get-Command aws.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $cmd) { $cmd = Get-Command aws -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if ($null -eq $cmd) { throw 'The AWS CLI is required; this script will not install it.' }
    return $cmd.Source
}
function Assert-AllowedAwsCall([string[]]$Arguments) {
    $key = "$($Arguments[0]) $($Arguments[1])"
    if ($AllowedAwsCalls -notcontains $key) { throw "Refusing AWS call outside the read-only allow-list: aws $key" }
}
function Invoke-Aws([string[]]$Arguments, [switch]$AllowFailure) {
    Assert-AllowedAwsCall $Arguments
    $line = "aws $($Arguments -join ' ') --profile $($cfg.Profile) --region $($cfg.Region) --output json"
    $script:AwsLog.Add("$([DateTime]::UtcNow.ToString('o')) $line")
    $prior = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $output = & $script:AwsCli @Arguments --profile $cfg.Profile --region $cfg.Region --output json 2>&1; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $prior }
    $text = @($output | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] } | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    $err = @($output | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { [string]$_ }) -join ' '
    if ($code -ne 0) {
        if ($AllowFailure) { return [pscustomobject]@{ Ok = $false; Data = $null; Error = "$err $text".Trim() } }
        throw "AWS command failed: $line :: $err $text"
    }
    $data = $(if ([string]::IsNullOrWhiteSpace($text)) { $null } else { $text | ConvertFrom-Json })
    if ($AllowFailure) { return [pscustomobject]@{ Ok = $true; Data = $data; Error = $null } }
    return $data
}
function Assert-NoProductionResolution {
    foreach ($name in @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN')) {
        if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) { throw "Refusing: $name is set. Use only the SSO profile $($cfg.Profile) (unset AWS_* first)." }
    }
    foreach ($name in @('AWS_PROFILE', 'AWS_DEFAULT_PROFILE')) {
        $v = [Environment]::GetEnvironmentVariable($name)
        if (-not [string]::IsNullOrEmpty($v) -and $v -ne $cfg.Profile) { throw "Refusing: $name resolves to '$v', not $($cfg.Profile)." }
    }
    $resolved = [ordered]@{}
    foreach ($key in @('sso_account_id', 'sso_role_name', 'role_arn', 'source_profile', 'region')) {
        $script:AwsLog.Add("aws configure get $key --profile $($cfg.Profile)")
        $prior = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $v = (& $script:AwsCli configure get $key --profile $cfg.Profile 2>$null | Select-Object -First 1) } finally { $ErrorActionPreference = $prior }
        $resolved[$key] = $(if ($null -eq $v) { '' } else { ([string]$v).Trim() })
    }
    foreach ($account in $productionAccounts) {
        if (@($resolved.Values | Where-Object { $_ -match $account }).Count) { throw "Refusing: profile $($cfg.Profile) resolves to production account $account." }
    }
    if ($resolved.sso_account_id -and $resolved.sso_account_id -ne $cfg.Account) { throw "Refusing: profile sso_account_id is $($resolved.sso_account_id)." }
    if ($resolved.sso_role_name -and $resolved.sso_role_name -notmatch $cfg.Role) { throw "Refusing: profile sso_role_name is $($resolved.sso_role_name)." }
    if ($resolved.source_profile) { throw "Refusing: profile $($cfg.Profile) chains through source_profile '$($resolved.source_profile)'." }
    return $resolved
}
function Assert-Identity {
    $identity = Invoke-Aws @('sts', 'get-caller-identity')
    if ($productionAccounts -contains $identity.Account) { throw "Refusing production account $($identity.Account)." }
    if ($identity.Account -ne $cfg.Account) { throw "Refusing AWS account '$($identity.Account)'; expected '$($cfg.Account)'." }
    if ($identity.Arn -notmatch "^arn:aws:sts::$($cfg.Account):assumed-role/[^/]*$($cfg.Role)[^/]*/[^/]+$") { throw "Refusing AWS identity '$($identity.Arn)'; expected an assumed $($cfg.Role) role." }
    return $identity
}

# ---------------------------------------------------------------- AWS evidence (describe/get/list)
function Get-ImageTags([string]$Digest) {
    if ($Digest -notmatch '^sha256:[0-9a-f]{64}$') { return $null }
    $r = Invoke-Aws @('ecr', 'describe-images', '--repository-name', $cfg.Repository, '--image-ids', "imageDigest=$Digest") -AllowFailure
    if (-not $r.Ok) { return [pscustomobject]@{ digest = $Digest; tags = @(); commit = $null; error = $r.Error } }
    $d = (@($r.Data.imageDetails) | Select-Object -First 1)
    $tags = @(Get-Prop $d 'imageTags' | Where-Object { $_ })
    $commit = @($tags | ForEach-Object { if ($_ -match '^(?:migration-)?([0-9a-f]{40})(?:-aws-native-staging)?$') { $Matches[1] } } | Select-Object -Unique)
    return [pscustomobject]@{ digest = $Digest; tags = $tags; commit = $(if ($commit.Count -eq 1) { $commit[0] } else { $null }); pushedAt = (Get-Prop $d 'imagePushedAt') }
}
function Get-ImageDigestFromRef([string]$Image) { if ($Image -match '@(sha256:[0-9a-f]{64})$') { return $Matches[1] }; return $null }
function Get-SafeEnvironment($Container) {
    $keep = @('CONFIGURATION_ENVIRONMENT', 'DEPLOYMENT_VERSION', 'TRACEPOINT_RUNTIME_PROVIDER_MODE', 'TRACEPOINT_DATA_PROVIDER', 'TRACEPOINT_EMAIL_PROVIDER', 'TRACEPOINT_NOTIFICATION_MODE', 'TRACEPOINT_DATABASE_CA_PATH')
    $map = [ordered]@{}
    foreach ($e in @(Get-Prop $Container 'environment')) { if ($null -ne $e -and $keep -contains $e.name) { $map[$e.name] = $e.value } }
    return $map
}
function Get-EcsEvidence {
    $service = (@((Invoke-Aws @('ecs', 'describe-services', '--cluster', $cfg.Cluster, '--services', $cfg.Service)).services) | Select-Object -First 1)
    if ($null -eq $service -or $service.status -ne 'ACTIVE') { throw 'The staging ECS service is not active.' }
    if ($service.serviceArn -ne "arn:aws:ecs:$($cfg.Region):$($cfg.Account):service/$($cfg.Cluster)/$($cfg.Service)") { throw 'ECS service identity mismatch.' }
    $td = (Invoke-Aws @('ecs', 'describe-task-definition', '--task-definition', $service.taskDefinition)).taskDefinition
    $container = (@($td.containerDefinitions) | Select-Object -First 1)
    $taskArns = @((Invoke-Aws @('ecs', 'list-tasks', '--cluster', $cfg.Cluster, '--service-name', $cfg.Service, '--desired-status', 'RUNNING')).taskArns)
    $running = @()
    if ($taskArns.Count) {
        $running = @((Invoke-Aws (@('ecs', 'describe-tasks', '--cluster', $cfg.Cluster, '--tasks') + $taskArns)).tasks | ForEach-Object {
                [pscustomobject]@{ taskArn = $_.taskArn; taskDefinitionArn = $_.taskDefinitionArn; lastStatus = $_.lastStatus; startedAt = (Get-Prop $_ 'startedAt'); imageDigests = @($_.containers | ForEach-Object { Get-Prop $_ 'imageDigest' }) } })
    }
    $digests = @($running | ForEach-Object { $_.imageDigests } | Where-Object { $_ } | Select-Object -Unique)
    $refDigest = Get-ImageDigestFromRef $container.image
    if ($refDigest -and $digests -notcontains $refDigest) { $digests += $refDigest }
    $images = @($digests | ForEach-Object { Get-ImageTags $_ })
    $family = $td.family
    # The prefix also matches longer family names (the runner family sorts first), so filter before taking 10.
    $history = @((Invoke-Aws @('ecs', 'list-task-definitions', '--family-prefix', $family, '--sort', 'DESC')).taskDefinitionArns | Where-Object { $_ -match ":task-definition/$([regex]::Escape($family)):\d+$" } | Select-Object -First 10)
    $revisions = @($history | ForEach-Object {
            $h = (Invoke-Aws @('ecs', 'describe-task-definition', '--task-definition', $_)).taskDefinition
            $img = (@($h.containerDefinitions) | Select-Object -First 1).image
            $dig = Get-ImageDigestFromRef $img
            $tags = $(if ($dig) { Get-ImageTags $dig } else { $null })
            [pscustomobject]@{ taskDefinitionArn = $h.taskDefinitionArn; revision = $h.revision; registeredAt = (Get-Prop $h 'registeredAt'); image = $img; imageTags = $(if ($tags) { $tags.tags } else { @() }); imageCommit = $(if ($tags) { $tags.commit } else { $null }); environment = (Get-SafeEnvironment ((@($h.containerDefinitions) | Select-Object -First 1))) } })
    $cb = Get-Prop (Get-Prop $service 'deploymentConfiguration') 'deploymentCircuitBreaker'
    $deployments = @($service.deployments | ForEach-Object { [pscustomobject]@{ id = $_.id; status = $_.status; taskDefinition = $_.taskDefinition; rolloutState = (Get-Prop $_ 'rolloutState'); desired = $_.desiredCount; running = $_.runningCount; createdAt = $_.createdAt; updatedAt = $_.updatedAt } })
    $primary = (@($deployments | Where-Object status -eq 'PRIMARY') | Select-Object -First 1)
    $currentImage = (@($images | Where-Object { $_.digest -eq $(if ($refDigest) { $refDigest } else { ($digests | Select-Object -First 1) }) }) | Select-Object -First 1)
    return [pscustomobject]@{
        service = [pscustomobject]@{ serviceArn = $service.serviceArn; taskDefinition = $service.taskDefinition; revision = $td.revision; desiredCount = $service.desiredCount; runningCount = $service.runningCount; deployments = $deployments; deploymentConfiguration = (Get-Prop $service 'deploymentConfiguration'); networkConfiguration = $service.networkConfiguration }
        currentTaskDefinition = [pscustomobject]@{ arn = $td.taskDefinitionArn; family = $family; revision = $td.revision; image = $container.image; environment = (Get-SafeEnvironment $container); secretNames = @(@(Get-Prop $container 'secrets') | Where-Object { $_ } | ForEach-Object { $_.name }) }
        runningTasks = $running; images = $images
        previousAppCommit = $(if ($currentImage) { $currentImage.commit } else { $null })
        circuitBreaker = $cb
        rollbackTarget = [pscustomobject]@{
            note = 'With the circuit breaker rollback enabled, a failed next deployment returns the service to the last COMPLETED deployment, which today is the PRIMARY below.'
            primaryDeploymentTaskDefinition = $(if ($primary) { $primary.taskDefinition } else { $null }); primaryRolloutState = $(if ($primary) { $primary.rolloutState } else { $null })
        }
        taskDefinitionHistory = $revisions
    }
}
function Get-RdsEvidence {
    $db = (@((Invoke-Aws @('rds', 'describe-db-instances', '--db-instance-identifier', $cfg.DbInstance)).DBInstances) | Select-Object -First 1)
    $snaps = @((Invoke-Aws @('rds', 'describe-db-snapshots', '--db-instance-identifier', $cfg.DbInstance)).DBSnapshots | Sort-Object { [string](Get-Prop $_ 'SnapshotCreateTime') } -Descending | Select-Object -First 10 |
        ForEach-Object { [pscustomobject]@{ id = $_.DBSnapshotIdentifier; arn = $_.DBSnapshotArn; type = $_.SnapshotType; status = $_.Status; created = (Get-Prop $_ 'SnapshotCreateTime'); engineVersion = $_.EngineVersion } })
    return [pscustomobject]@{ instance = [pscustomobject]@{ id = $db.DBInstanceIdentifier; arn = $db.DBInstanceArn; engine = $db.Engine; engineVersion = $db.EngineVersion; status = $db.DBInstanceStatus; backupRetentionDays = $db.BackupRetentionPeriod; publiclyAccessible = $db.PubliclyAccessible }; latestSnapshots = $snaps }
}
# Notification delivery: the app only sends queued email when something POSTs
# /api/notifications/email-dispatch (infra/lib defines no schedule for it,
# TRN-08). Look for any schedule, rule or API destination that could, and
# record the runtime notification settings. Nothing here changes delivery.
function Get-NotificationEvidence($Ecs) {
    $pattern = '(?i)dispatch|notification|email'
    $found = [System.Collections.Generic.List[object]]::new(); $unverified = [System.Collections.Generic.List[string]]::new()
    $schedules = Invoke-Aws @('scheduler', 'list-schedules') -AllowFailure
    $scheduleList = @()
    if ($schedules.Ok) {
        $scheduleList = @(@(Get-Prop $schedules.Data 'Schedules') | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ name = $_.Name; group = $_.GroupName; state = $_.State; target = (Get-Prop (Get-Prop $_ 'Target') 'Arn') } })
        foreach ($s in $scheduleList) { if ("$($s.name) $($s.group) $($s.target)" -match $pattern) { $found.Add([pscustomobject]@{ kind = 'scheduler'; item = $s }) } }
    } else { $unverified.Add("scheduler list-schedules: $($schedules.Error)") }
    $rules = Invoke-Aws @('events', 'list-rules') -AllowFailure
    $ruleList = @()
    if ($rules.Ok) {
        foreach ($r in @(@(Get-Prop $rules.Data 'Rules') | Where-Object { $_ })) {
            $t = Invoke-Aws @('events', 'list-targets-by-rule', '--rule', $r.Name) -AllowFailure
            $targets = $(if ($t.Ok) { @(@(Get-Prop $t.Data 'Targets') | Where-Object { $_ } | ForEach-Object { $_.Arn }) } else { $unverified.Add("events list-targets-by-rule $($r.Name): $($t.Error)"); @() })
            $entry = [pscustomobject]@{ name = $r.Name; state = $r.State; schedule = (Get-Prop $r 'ScheduleExpression'); targets = $targets }
            $ruleList += $entry
            if ("$($entry.name) $($entry.targets -join ' ')" -match $pattern -or ($entry.targets -join ' ') -match ':api-destination/') { $found.Add([pscustomobject]@{ kind = 'eventbridge-rule'; item = $entry }) }
        }
    } else { $unverified.Add("events list-rules: $($rules.Error)") }
    $dest = Invoke-Aws @('events', 'list-api-destinations') -AllowFailure
    $destList = @()
    if ($dest.Ok) {
        $destList = @(@(Get-Prop $dest.Data 'ApiDestinations') | Where-Object { $_ } | ForEach-Object { [pscustomobject]@{ name = $_.Name; state = $_.ApiDestinationState; endpoint = $_.InvocationEndpoint } })
        foreach ($d in $destList) { if ("$($d.name) $($d.endpoint)" -match $pattern) { $found.Add([pscustomobject]@{ kind = 'api-destination'; item = $d }) } }
    } else { $unverified.Add("events list-api-destinations: $($dest.Error)") }
    $ses = Invoke-Aws @('sesv2', 'get-account') -AllowFailure
    $sesState = $(if ($ses.Ok) { [pscustomobject]@{ sendingEnabled = (Get-Prop $ses.Data 'SendingEnabled'); productionAccessEnabled = (Get-Prop $ses.Data 'ProductionAccessEnabled'); enforcementStatus = (Get-Prop $ses.Data 'EnforcementStatus') } } else { [pscustomobject]@{ error = $ses.Error } })
    $envMap = $Ecs.currentTaskDefinition.environment
    return [pscustomobject]@{
        dispatchEndpoint = '/api/notifications/email-dispatch (POST, bearer NOTIFICATION_DISPATCH_SECRET)'
        invokersFound = $found; unverified = $unverified
        schedules = $scheduleList; eventBridgeRules = $ruleList; apiDestinations = $destList
        runtime = [pscustomobject]@{ notificationMode = $envMap['TRACEPOINT_NOTIFICATION_MODE']; emailProvider = $envMap['TRACEPOINT_EMAIL_PROVIDER']; dispatchSecretInjected = ($Ecs.currentTaskDefinition.secretNames -contains 'NOTIFICATION_DISPATCH_SECRET') }
        ses = $sesState
        disabled = ($found.Count -eq 0 -and $unverified.Count -eq 0)
    }
}
# The established migration runner: a revision of the bootstrap family already
# registered by apply-app-migrations.ps1 (migrator secret as
# TRACEPOINT_DATABASE_SECRET_JSON, RDS CA, staging configuration). Reused as is.
function Get-RunnerRevision {
    $arns = @((Invoke-Aws @('ecs', 'list-task-definitions', '--family-prefix', $cfg.RunnerFamily, '--sort', 'DESC', '--max-items', '25')).taskDefinitionArns | Where-Object { $_ -match ":task-definition/$([regex]::Escape($cfg.RunnerFamily)):\d+$" })
    $rejected = [System.Collections.Generic.List[string]]::new()
    foreach ($arn in $arns) {
        $td = (Invoke-Aws @('ecs', 'describe-task-definition', '--task-definition', $arn)).taskDefinition
        $containers = @($td.containerDefinitions)
        $c = $containers[0]
        $secrets = @(@(Get-Prop $c 'secrets') | Where-Object { $_ })
        $envMap = Get-SafeEnvironment $c
        $log = Get-Prop $c 'logConfiguration'
        $entry = @(Get-Prop $c 'entryPoint' | Where-Object { $_ })
        $why = @()
        if ($td.networkMode -ne 'awsvpc' -or @($td.requiresCompatibilities) -notcontains 'FARGATE' -or $containers.Count -ne 1) { $why += 'not a single-container Fargate task' }
        if ($secrets.Count -ne 1 -or $secrets[0].name -ne 'TRACEPOINT_DATABASE_SECRET_JSON' -or -not ([string]$secrets[0].valueFrom).StartsWith($cfg.MigratorSecretArn)) { $why += 'secret is not exactly the migrator secret' }
        if ($envMap['CONFIGURATION_ENVIRONMENT'] -ne 'staging' -or $envMap['TRACEPOINT_DATABASE_CA_PATH'] -ne '/app/rds-ca.pem') { $why += 'environment is not the staging runner environment' }
        if ($c.image -notmatch "^$($cfg.Account)\.dkr\.ecr\.$($cfg.Region)\.amazonaws\.com/$($cfg.Repository)@sha256:[0-9a-f]{64}$") { $why += 'image is not digest-pinned in the staging repository' }
        if ($null -eq $log -or $log.logDriver -ne 'awslogs' -or -not (Get-Prop $log.options 'awslogs-group') -or -not (Get-Prop $log.options 'awslogs-stream-prefix')) { $why += 'no awslogs configuration' }
        if ($entry.Count -gt 0 -and @('node', '/nodejs/bin/node') -notcontains ($entry -join ' ')) { $why += "entryPoint '$($entry -join ' ')' is not node" }
        if ($why.Count -eq 0) {
            $tags = Get-ImageTags (Get-ImageDigestFromRef $c.image)
            return [pscustomobject]@{ taskDefinitionArn = $td.taskDefinitionArn; revision = $td.revision; container = $c.name; image = $c.image; imageTags = $tags.tags; imageCommit = $tags.commit; logGroup = $log.options.'awslogs-group'; streamPrefix = $log.options.'awslogs-stream-prefix'; rejectedNewer = $rejected }
        }
        $rejected.Add("$arn : $($why -join '; ')")
    }
    throw ("STOP: no registered $($cfg.RunnerFamily) revision has the migration-runner shape, so the kit cannot run without a new task-definition registration. " +
        "That registration is what scripts/apply-app-migrations.ps1 does on every run (including -Action status); it is an owner decision and this procedure will not do it. Rejected: $($rejected -join ' | ')")
}

# ---------------------------------------------------------------- kit tasks
function Get-NetworkArgument($Ecs) {
    $a = $Ecs.service.networkConfiguration.awsvpcConfiguration
    return "awsvpcConfiguration={subnets=[$($a.subnets -join ',')],securityGroups=[$($a.securityGroups -join ',')],assignPublicIp=$($a.assignPublicIp)}"
}
function Start-ChunkTask($Chunk, $Runner, [string]$Network) {
    if ($Runner.taskDefinitionArn -notmatch ":task-definition/$([regex]::Escape($cfg.RunnerFamily)):\d+$") { throw 'run-task is limited to the migration-runner family.' }
    if ($Chunk.OverridesBytes -gt $cfg.OverridesBudget) { throw "Chunk $($Chunk.Id) overrides too large." }
    $file = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-ro-preflight-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        [IO.File]::WriteAllText($file, $Chunk.Overrides, [Text.UTF8Encoding]::new($false))
        $r = Invoke-Aws @('ecs', 'run-task', '--cluster', $cfg.Cluster, '--task-definition', $Runner.taskDefinitionArn, '--launch-type', 'FARGATE', '--count', '1', '--started-by', 'tracepoint-ro-preflight', '--network-configuration', $Network, '--overrides', "file://$file")
    } finally { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } }
    $task = (@($r.tasks) | Select-Object -First 1)
    if ($null -eq $task -or -not $task.taskArn -or @($r.failures).Count) { throw "Chunk $($Chunk.Id) task did not start: $(@($r.failures) | ConvertTo-Json -Compress -Depth 5)" }
    Write-Host "  started $($Chunk.Id): $($task.taskArn)"
    return $task.taskArn
}
function Wait-Tasks([string[]]$TaskArns) {
    Assert-AllowedAwsCall @('ecs', 'wait')
    $script:AwsLog.Add("$([DateTime]::UtcNow.ToString('o')) aws ecs wait tasks-stopped --cluster $($cfg.Cluster) --tasks $($TaskArns -join ' ') --profile $($cfg.Profile) --region $($cfg.Region)")
    & $script:AwsCli ecs wait tasks-stopped --cluster $cfg.Cluster --tasks @TaskArns --profile $cfg.Profile --region $cfg.Region
    if ($LASTEXITCODE -ne 0) { Write-Warning 'ecs wait tasks-stopped did not confirm every task stopped; continuing with describe-tasks.' }
    return @((Invoke-Aws (@('ecs', 'describe-tasks', '--cluster', $cfg.Cluster, '--tasks') + $TaskArns)).tasks)
}
function Get-ChunkRecords($Chunk, [string]$TaskArn, $Runner) {
    $taskId = ($TaskArn -split '/')[-1]
    $stream = "$($Runner.streamPrefix)/$($Runner.container)/$taskId"
    $messages = @(); $records = @()
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        $r = Invoke-Aws @('logs', 'filter-log-events', '--log-group-name', $Runner.logGroup, '--log-stream-names', $stream) -AllowFailure
        if ($r.Ok) { $messages = @(@(Get-Prop $r.Data 'events') | Where-Object { $_ } | ForEach-Object { [string]$_.message }) }
        $records = ConvertFrom-RunnerLog $messages $Chunk.Id
        if (@($records | Where-Object { $_.t -in @('done', 'fatal') }).Count) { break }
        Start-Sleep -Seconds 5
    }
    return [pscustomobject]@{ Stream = $stream; Messages = $messages; Records = $records }
}
function ConvertFrom-RunnerLog([string[]]$Messages, [string]$Id) {
    $parts = @{}
    foreach ($m in $Messages) {
        if ($m -match '^TPPF (\S+) (\d+) (\d+) (\d+) (.*)$' -and $Matches[1] -eq $Id) {
            $n = [int]$Matches[2]
            if (-not $parts.ContainsKey($n)) { $parts[$n] = @{ total = [int]$Matches[4]; items = @{} } }
            $parts[$n].items[[int]$Matches[3]] = $Matches[5]
        }
    }
    $out = foreach ($n in ($parts.Keys | Sort-Object)) {
        $p = $parts[$n]
        if ($p.items.Count -ne $p.total) { [pscustomobject]@{ t = 'fatal'; message = "log record $n incomplete ($($p.items.Count)/$($p.total))" }; continue }
        (((0..($p.total - 1)) | ForEach-Object { $p.items[$_] }) -join '') | ConvertFrom-Json
    }
    return @($out)
}
function Format-Cell($v) {
    if ($null -eq $v) { return '(null)' }
    if ($v -is [bool]) { if ($v) { return 't' } else { return 'f' } }
    if ($v -is [DateTime]) { return $v.ToUniversalTime().ToString('o') }
    if ($v -is [string] -or $v -is [ValueType]) { return [string]$v }
    return ($v | ConvertTo-Json -Compress -Depth 10)
}
function Format-Records($Records) {
    $sb = [Text.StringBuilder]::new()
    foreach ($r in $Records) {
        switch ($r.t) {
            'echo' { [void]$sb.AppendLine($r.text) }
            'session' { [void]$sb.AppendLine("SESSION current_user=$($r.cu) database=$($r.db) server_version=$($r.sv) transaction_read_only=$($r.ro) default_transaction_read_only=$($r.dro) at=$(Format-Cell $r.at) chunk_sha256=$($r.sha256)") }
            'rows' {
                [void]$sb.AppendLine((@($r.fields) -join ' | '))
                foreach ($row in @($r.rows)) { [void]$sb.AppendLine(((@($row) | ForEach-Object { Format-Cell $_ }) -join ' | ')) }
                [void]$sb.AppendLine("($(@($r.rows).Count) rows)"); [void]$sb.AppendLine()
            }
            'error' { [void]$sb.AppendLine("ERROR statement $($r.n): $($r.code) $($r.message)") }
            'done' { [void]$sb.AppendLine("DONE statements=$($r.statements) errors=$($r.errors)") }
            'fatal' { [void]$sb.AppendLine("FATAL $($r.message)") }
        }
    }
    return $sb.ToString()
}
# Attach the kit section label (G2.1, G3.5, Q3, R0 ...) to each result set.
function Get-LabelledResults($AllRecords) {
    $label = $null
    foreach ($r in $AllRecords) {
        if ($r.t -eq 'echo' -and $r.text -match '^(?:--|====)\s+(G\d[a-z]?(?:\.\d+)?|Q\d+b?|R\d|A\.\d)\b') { $label = $Matches[1] }
        elseif ($r.t -eq 'rows') { [pscustomobject]@{ Label = $label; Fields = @($r.fields); Rows = @($r.rows) } }
    }
}
function Get-Column($Result, [string]$Name) {
    $i = [Array]::IndexOf([object[]]$Result.Fields, $Name)
    if ($i -lt 0) { return $null }
    return @($Result.Rows | ForEach-Object { @($_)[$i] })
}

# ---------------------------------------------------------------- evaluation
function New-Check([string]$Gate, [string]$Result, [string]$Detail) { return [pscustomobject]@{ gate = $Gate; result = $Result; detail = $Detail } }
function Test-KitResults($Results, $Release, $ChunkRuns) {
    $checks = [System.Collections.Generic.List[object]]::new()
    foreach ($run in $ChunkRuns) {
        $done = (@($run.Records | Where-Object t -eq 'done') | Select-Object -First 1); $fatal = @($run.Records | Where-Object t -eq 'fatal')
        $session = (@($run.Records | Where-Object t -eq 'session') | Select-Object -First 1)
        $ok = $null -ne $done -and $fatal.Count -eq 0 -and $run.ExitCode -eq 0 -and $null -ne $session -and $session.sha256 -eq $run.Chunk.Sha256 -and $session.ro -eq 'on' -and $session.dro -eq 'on' -and $session.cu -eq 'tracepoint_migrator' -and $session.db -eq 'tracepoint'
        $errors = $(if ($done) { [int]$done.errors } else { -1 })
        $checks.Add((New-Check "kit chunk $($run.Chunk.Id)" $(if ($ok -and $errors -eq 0) { 'PASS' } else { 'FAIL' }) "exit=$($run.ExitCode) stop=$($run.StopCode) errors=$errors fatal=$(@($fatal | ForEach-Object { $_.message }) -join ';') user=$(if ($session) { $session.cu }) ro=$(if ($session) { "$($session.ro)/$($session.dro)" }) server=$(if ($session) { $session.sv })"))
    }
    $byLabel = { param($l) @($Results | Where-Object { $_.Label -eq $l }) }
    $versions = @(); $g21 = (@(& $byLabel 'G2.1') | Select-Object -First 1)
    if ($null -eq $g21) { $checks.Add((New-Check 'G2 ledger vs release' 'FAIL' 'G2.1 ledger rows missing')) }
    else {
        $expected = @{}; foreach ($f in $Release.Files) { $expected[[int]$f.version] = $f }
        $vi = [Array]::IndexOf([object[]]$g21.Fields, 'version'); $fi = [Array]::IndexOf([object[]]$g21.Fields, 'filename'); $si = [Array]::IndexOf([object[]]$g21.Fields, 'content_sha256')
        $drift = @()
        foreach ($row in $g21.Rows) {
            $r = @($row); $v = [int]$r[$vi]; $versions += $v
            $e = $expected[$v]
            if ($null -eq $e) { $drift += "$v (no file at release)" } elseif ($e.filename -ne $r[$fi] -or $e.sha256 -ne $r[$si]) { $drift += "$v ($($r[$fi]) $($r[$si]) vs $($e.filename) $($e.sha256))" }
        }
        $pending = @($Release.Files | Where-Object { $versions -notcontains $_.version } | ForEach-Object { $_.version })
        $wantApplied = $(if ($Phase -eq 'before') { $expectedApplied } else { @($Release.Files | ForEach-Object { $_.version }) })
        $wantPending = $(if ($Phase -eq 'before') { $expectedPending } else { @() })
        $ok = $drift.Count -eq 0 -and (($versions | Sort-Object) -join ',') -eq ($wantApplied -join ',') -and ($pending -join ',') -eq ($wantPending -join ',')
        $checks.Add((New-Check 'G2 ledger vs release commit' $(if ($ok) { 'PASS' } else { 'FAIL' }) "phase=$Phase applied=$($versions.Count) (latest $(($versions | Measure-Object -Maximum).Maximum)) pending=[$($pending -join ',')] ($($pending.Count)) drift=[$($drift -join '; ')] release=$($Release.Commit)"))
    }
    foreach ($l in @('G3.1', 'G3.2', 'G3.3', 'G3.4')) {
        $sets = & $byLabel $l
        $col = 'present'
        $bad = @($sets | ForEach-Object { $res = $_; $vals = Get-Column $res $col; if ($null -eq $vals) { @($res.Rows | ForEach-Object { @($_) | Where-Object { $_ -is [bool] -and -not $_ } }) } else { @($vals | Where-Object { $_ -ne $true }) } })
        $checks.Add((New-Check $l $(if ($sets.Count -and $bad.Count -eq 0) { 'PASS' } else { 'FAIL' }) "$(@($sets | ForEach-Object { $_.Rows.Count }) -join '+') rows, $($bad.Count) false"))
    }
    $g35 = (@(& $byLabel 'G3.5') | Select-Object -First 1)
    $own = $(if ($g35) { @(Get-Column $g35 'owned_by_migrator') } else { @() })
    $checks.Add((New-Check 'G3.5 owners' $(if ($g35 -and @($own | Where-Object { $_ -ne $true }).Count -eq 0) { 'PASS' } else { 'FAIL' }) "$($own.Count) rows, $(@($own | Where-Object { $_ -ne $true }).Count) not owned by tracepoint_migrator"))
    $g36 = (@(& $byLabel 'G3.6') | Select-Object -First 1)
    if ($Phase -eq 'before') {
        $bad = @()
        if ($g36) {
            $oi = [Array]::IndexOf([object[]]$g36.Fields, 'object'); $gi = [Array]::IndexOf([object[]]$g36.Fields, 'grantor_is_owner')
            foreach ($row in $g36.Rows) { $r = @($row); $required = $Release.Revokes053FirearmHistory -or ([string]$r[$oi]) -notmatch 'firearm_status_history'; if ($required -and $r[$gi] -ne $true) { $bad += [string]$r[$oi] } }
        }
        $checks.Add((New-Check 'G3.6 grantors' $(if ($g36 -and $bad.Count -eq 0) { 'PASS' } else { 'FAIL' }) "$(if ($g36) { $g36.Rows.Count } else { 0 }) rows; firearm_status_history rows required: $($Release.Revokes053FirearmHistory); grantor<>owner on: $($bad -join ', ')"))
    } else { $checks.Add((New-Check 'G3.6 grantors (after)' 'REVIEW' "Compare with README section 3; expand variant keeps authenticated INSERT on firearm_status_history: $(-not $Release.Revokes053FirearmHistory)")) }
    $g37 = (@(& $byLabel 'G3.7') | Select-Object -First 1)
    if ($g37) {
        $mi = [Array]::IndexOf([object[]]$g37.Fields, 'migration'); $pi = [Array]::IndexOf([object[]]$g37.Fields, 'present'); $ni = [Array]::IndexOf([object[]]$g37.Fields, 'policy_name')
        $bad = @()
        foreach ($row in $g37.Rows) {
            $r = @($row); $is053 = [string]$r[$mi] -eq '053'
            if ($Phase -eq 'before') { if ((-not $is053 -or $Release.Revokes053FirearmHistory) -and $r[$pi] -ne $true) { $bad += [string]$r[$ni] } }
            elseif ($is053 -and [bool]$r[$pi] -ne (-not $Release.Revokes053FirearmHistory)) { $bad += [string]$r[$ni] }
        }
        $checks.Add((New-Check 'G3.7 policy names' $(if ($bad.Count -eq 0) { $(if ($Phase -eq 'before') { 'PASS' } else { 'REVIEW' }) } else { 'FAIL' }) "$($g37.Rows.Count) rows; unexpected: $($bad -join ', ')$(if ($Phase -eq 'after') { '; other after-apply rows: compare with README section 3' })"))
    } else { $checks.Add((New-Check 'G3.7 policy names' 'FAIL' 'result missing')) }
    $g39 = @(& $byLabel 'G3.9')
    $differs = @($g39 | ForEach-Object { $res = $_; @($res.Rows | Where-Object { (@($_) -join ' ') -match 'differs' }) }).Count
    $checks.Add((New-Check 'G3.8/G3.9 policies and fingerprints' 'RECORDED' "G3.9 rows marked 'differs': $differs (advisory, inspect by hand)"))
    $r0 = (@(& $byLabel 'G4f' | Where-Object { $_.Fields -contains 'timezone' }) | Select-Object -First 1)
    $roles = (@(& $byLabel 'G4f' | Where-Object { $_.Fields -contains 'setconfig' }) | Select-Object -First 1)
    if ($r0) {
        $row = @((@($r0.Rows) | Select-Object -First 1))
        $override = @(); if ($roles) { $override = @($roles.Rows | Where-Object { $x = @($_); ($x[0] -in @('tracepoint_runtime', '(all roles)')) -and ((@($x[2]) -join ' ') -match '(?i)timezone|datestyle|intervalstyle') }) }
        $ok = $row[0] -in @('UTC', 'Etc/UTC') -and $row[1] -eq 'ISO, MDY' -and $row[2] -eq 'postgres' -and $override.Count -eq 0
        $checks.Add((New-Check 'G4f DC2 R0' $(if ($ok) { 'PASS' } else { 'FAIL' }) "TimeZone=$($row[0]) DateStyle=$($row[1]) IntervalStyle=$($row[2]) overrides=$($override.Count)"))
    } else { $checks.Add((New-Check 'G4f DC2 R0' 'FAIL' 'result missing')) }
    foreach ($l in @('G4a', 'G4b', 'G4c', 'G4d', 'G4e', 'G4g')) { $n = $(if ($l -eq 'G4c') { @($Results | Where-Object { $_.Label -match '^Q\d' }).Count } else { @(& $byLabel $l).Count }); $checks.Add((New-Check "$l preview" $(if ($n) { 'RECORDED' } else { 'FAIL' }) "$n result sets recorded")) }
    $g4g = (@(& $byLabel 'G4g') | Select-Object -First 1)
    if ($g4g) { $pendingRows = 0; $si = [Array]::IndexOf([object[]]$g4g.Fields, 'status'); $ri = [Array]::IndexOf([object[]]$g4g.Fields, 'rows'); foreach ($row in $g4g.Rows) { $r = @($row); if ($r[$si] -eq 'Pending') { $pendingRows += [int]$r[$ri] } }; $checks.Add((New-Check 'G4g Pending email rows' 'RECORDED' "$pendingRows Pending (the dispatcher stays off)")) }
    if ($Phase -eq 'after') {
        $a3 = (@(& $byLabel 'A.3') | Select-Object -First 1)
        if ($a3) {
            $r = @((@($a3.Rows) | Select-Object -First 1)); $keep = -not $Release.Revokes053FirearmHistory
            $ok = $r[0] -eq $false -and [bool]$r[1] -eq $keep -and $r[2] -eq $false -and [bool]$r[3] -eq $keep -and [int]$r[4] -eq 0
            $checks.Add((New-Check 'A.3 history privileges' $(if ($ok) { 'PASS' } else { 'FAIL' }) "rifle insert=$($r[0]) firearm insert=$($r[1]) rifle update/delete=$($r[2]) firearm update/delete=$($r[3]) workflow_note=$($r[4]); this 053 keeps firearm history grants: $keep"))
        }
        $a7 = (@(& $byLabel 'A.7') | Select-Object -First 1)
        $bad = @()
        if ($a7) {
            $ix = @{}; foreach ($n in @('trigger_name', 'function_present', 'trigger_enabled', 'search_path_fixed', 'public_execute', 'authenticated_execute', 'anon_execute', 'runtime_execute')) { $ix[$n] = [Array]::IndexOf([object[]]$a7.Fields, $n) }
            foreach ($row in $a7.Rows) {
                $r = @($row)
                $granted = @(@('public_execute', 'authenticated_execute', 'anon_execute', 'runtime_execute') | ForEach-Object { $r[$ix[$_]] } | Where-Object { $_ -ne $false })
                if ($r[$ix['function_present']] -ne $true -or $r[$ix['trigger_enabled']] -ne $true -or $r[$ix['search_path_fixed']] -ne $true -or $granted.Count) { $bad += [string]$r[$ix['trigger_name']] }
            }
        }
        $checks.Add((New-Check 'A.7 rollback-compatibility triggers' $(if ($a7 -and @($a7.Rows).Count -eq 3 -and $bad.Count -eq 0) { 'PASS' } else { 'FAIL' }) "$(if ($a7) { @($a7.Rows).Count } else { 0 }) rows (042, 046, 052); missing, disabled, unfixed search_path or EXECUTE reachable: $($bad -join ', ')"))
        $checks.Add((New-Check 'A.1-A.6' 'REVIEW' 'Compare with README section 3 (after column).'))
    }
    return , $checks
}

# ---------------------------------------------------------------- self-test (no AWS)
function Invoke-SelfTest {
    $results = [System.Collections.Generic.List[object]]::new()
    function Add-Result([string]$Name, [scriptblock]$Body) {
        try { $detail = & $Body; $results.Add([pscustomobject]@{ test = $Name; result = 'PASS'; detail = [string]$detail }) }
        catch { $results.Add([pscustomobject]@{ test = $Name; result = 'FAIL'; detail = $_.Exception.Message }) }
    }
    Add-Result 'forbidden-verb scan of this script' { $h = Get-ForbiddenVerbHits ([IO.File]::ReadAllLines($PSCommandPath)); if ($h.Count) { throw ($h -join '; ') }; 'clean' }
    Add-Result 'forbidden-verb scan detects calls' {
        foreach ($s in $ForbiddenSamples) { if ((Get-ForbiddenVerbHits @($RegionMarkers[0], $RegionMarkers[1], $s)).Count -eq 0) { throw "not detected: $s" } }
        if ((Get-ForbiddenVerbHits $RegionSample).Count) { throw 'allow-list region not honoured' }
        if ((Get-ForbiddenVerbHits @('aws ecs describe-services')).Count -eq 0) { throw 'missing region not reported' }
        if ((Get-ForbiddenVerbHits @($RegionMarkers[0], $RegionMarkers[1], 'scripts/apply-app-migrations.ps1 describe')).Count) { throw 'a script file name was flagged' }
        "$($ForbiddenSamples.Count) samples detected"
    }
    Add-Result 'AWS allow-list refuses writes' {
        foreach ($a in $RefusedCallSamples) { $refused = $false; try { Assert-AllowedAwsCall $a } catch { $refused = $true }; if (-not $refused) { throw "allowed: $($a -join ' ')" } }
        foreach ($a in @(@('ecs', 'describe-services'), @('ecs', 'run-task'), @('logs', 'filter-log-events'))) { Assert-AllowedAwsCall $a }
        'ok'
    }
    Add-Result 'JSON string encoding' {
        $s = "a`"b\c`n'<>&" + [char]1
        if ((('{"v":' + (ConvertTo-JsonString $s) + '}') | ConvertFrom-Json).v -ne $s) { throw 'round trip failed' }
        'ok'
    }
    $repo = Get-RepositoryState
    $kit = $null
    Add-Result 'kit sha256 and blob id' { $script:kitForTest = Get-Kit $repo.Head; "sha256 $($script:kitForTest.Sha256)" }
    if ($null -ne (Get-Variable kitForTest -Scope Script -ErrorAction SilentlyContinue)) { $kit = $script:kitForTest }
    if ($kit) {
        Add-Result 'runner gzip round trip' { $b = [Text.Encoding]::UTF8.GetBytes($RunnerJs); if ((Get-Sha256Hex (ConvertFrom-GzipBase64 (ConvertTo-GzipBase64 $b))) -ne (Get-Sha256Hex $b)) { throw 'mismatch' }; "runner $($b.Length) bytes" }
        Add-Result 'chunking, sha256 and size budget' {
            $chunks = Get-KitChunks $kit.Text 'bootstrap' $cfg.OverridesBudget
            Assert-Chunks $kit $chunks
            $script:chunksForTest = $chunks
            (@($chunks | ForEach-Object { "$($_.Id) L$($_.FirstLine)-$($_.LastLine) $($_.Bytes)B gz64=$($_.GzipBase64.Length) overrides=$($_.OverridesBytes)" }) -join '; ')
        }
        Add-Result 'chunk splitting under a smaller budget' {
            # One byte below the largest chunk, so that chunk must split again
            # (a fixed 6000 is infeasible: G2.2 alone needs about 7,300 bytes).
            $base = Get-KitChunks $kit.Text 'bootstrap' $cfg.OverridesBudget
            $small = [int](($base | Measure-Object -Property OverridesBytes -Maximum).Maximum) - 1
            $chunks = Get-KitChunks $kit.Text 'bootstrap' $small
            $joined = ($chunks | ForEach-Object { $kit.Text.Substring($_.Start, $_.End - $_.Start) }) -join ''
            if ($joined -ne $kit.Text) { throw 'split chunks do not reassemble' }
            if (@($chunks | Where-Object { $_.OverridesBytes -gt $small }).Count) { throw 'a split chunk exceeds the budget' }
            if ($chunks.Count -le $base.Count) { throw 'no chunk was split again' }
            "$($chunks.Count) chunks at $small (from $($base.Count))"
        }
        Add-Result 'tampered chunk detected' {
            $c = Get-KitChunks $kit.Text 'bootstrap' $cfg.OverridesBudget
            $c[1] = [pscustomobject]@{ Id = $c[1].Id; Start = $c[1].Start; End = $c[1].End; Sha256 = $c[1].Sha256; GzipBase64 = (ConvertTo-GzipBase64 ([Text.Encoding]::UTF8.GetBytes('select 1;'))); OverridesBytes = $c[1].OverridesBytes }
            $caught = $false; try { Assert-Chunks $kit $c } catch { $caught = $true }
            if (-not $caught) { throw 'not detected' }; 'detected'
        }
        Add-Result 'runner log reassembly' {
            $payload = '{"t":"rows","n":1,"fields":["a"],"rows":[[true]]}'
            $recs = ConvertFrom-RunnerLog @("TPPF G2 0 1 2 $($payload.Substring(20))", "TPPF G2 0 0 2 $($payload.Substring(0, 20))", 'noise', 'TPPF G3 0 0 1 {"t":"done"}') 'G2'
            if ($recs.Count -ne 1 -or $recs[0].t -ne 'rows' -or (@(@($recs[0].rows)[0]) | Select-Object -First 1) -ne $true) { throw 'reassembly failed' }; 'ok'
        }
    }
    Add-Result "release commit $ReleaseCommit expectations" {
        $r = Get-ReleaseExpectation $ReleaseCommit -SkipAncestry
        "$($r.Files.Count) files; on $($cfg.IntegrationRef): $($r.OnIntegrationBranch); 053 $((@($r.Files | Where-Object version -eq 53) | Select-Object -First 1).sha256); $($r.Variant)"
    }
    Add-Result 'working tree clean' { if ($repo.Dirty.Count) { throw "$($repo.Dirty.Count) changes" }; "HEAD $($repo.Head)" }
    $results | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
    if (@($results | Where-Object result -eq 'FAIL').Count) { Write-Host 'SELF-TEST FAILED'; exit 1 }
    Write-Host 'SELF-TEST PASSED'
}

# ---------------------------------------------------------------- plan
function Show-Plan($Chunks, $Release) {
    $p = "--profile $($cfg.Profile) --region $($cfg.Region) --output json"
    $lines = @(
        "aws configure get sso_account_id|sso_role_name|role_arn|source_profile|region --profile $($cfg.Profile)   (local config only)",
        "aws sts get-caller-identity $p",
        "aws ecs describe-services --cluster $($cfg.Cluster) --services $($cfg.Service) $p",
        "aws ecs describe-task-definition --task-definition <service taskDefinition> $p",
        "aws ecs list-tasks --cluster $($cfg.Cluster) --service-name $($cfg.Service) --desired-status RUNNING $p",
        "aws ecs describe-tasks --cluster $($cfg.Cluster) --tasks <running task arns> $p",
        "aws ecr describe-images --repository-name $($cfg.Repository) --image-ids imageDigest=<each running/revision digest> $p",
        "aws ecs list-task-definitions --family-prefix <service family> --sort DESC $p   (newest 10 of that exact family kept)",
        "aws ecs describe-task-definition --task-definition <each of those 10 revisions> $p",
        "aws rds describe-db-instances --db-instance-identifier $($cfg.DbInstance) $p",
        "aws rds describe-db-snapshots --db-instance-identifier $($cfg.DbInstance) $p",
        "aws scheduler list-schedules $p",
        "aws events list-rules $p",
        "aws events list-targets-by-rule --rule <each rule> $p",
        "aws events list-api-destinations $p",
        "aws sesv2 get-account $p",
        "aws ecs list-task-definitions --family-prefix $($cfg.RunnerFamily) --sort DESC --max-items 25 $p",
        "aws ecs describe-task-definition --task-definition <newest $($cfg.RunnerFamily) revisions until one has the runner shape> $p"
    )
    if ($RunMigrateDbStatus) {
        $lines += "aws ecr describe-images --repository-name $($cfg.Repository) --image-ids imageTag=$($Release.Commit)-aws-native-staging and imageTag=migration-$($Release.Commit)-aws-native-staging $p   (pre-check; skipped unless both exist)"
        $lines += "git worktree add --quiet --detach <temp> $($Release.Commit); <temp>/scripts/migrate-db.ps1 staging -Action status; git worktree remove --force <temp>   (registers one $($cfg.RunnerFamily) revision; runs the runner in status mode)"
        $lines += "aws ecs describe-tasks / describe-task-definition / logs filter-log-events for the migrate-db task $p"
    }
    $lines += "aws sts get-caller-identity $p   (re-check before launching)"
    foreach ($c in $Chunks) {
        $lines += "aws ecs run-task --cluster $($cfg.Cluster) --task-definition <runner revision arn> --launch-type FARGATE --count 1 --started-by tracepoint-ro-preflight --network-configuration <service awsvpcConfiguration> --overrides file://<temp: chunk $($c.Id), kit lines $($c.FirstLine)-$($c.LastLine), sha256 $($c.Sha256), $($c.OverridesBytes) bytes> $p"
        if ($c.Id -eq 'SESSION') { $lines += "aws ecs wait tasks-stopped --cluster $($cfg.Cluster) --tasks <SESSION task>; aws ecs describe-tasks ...; aws logs filter-log-events --log-group-name <runner awslogs-group> --log-stream-names <prefix>/<container>/<task id> $p   (canary: must show tracepoint_migrator, read-only on)" }
    }
    $lines += "aws ecs wait tasks-stopped --cluster $($cfg.Cluster) --tasks <all remaining chunk tasks> --profile $($cfg.Profile) --region $($cfg.Region)"
    $lines += "aws ecs describe-tasks --cluster $($cfg.Cluster) --tasks <all chunk tasks> $p"
    $lines += "aws logs filter-log-events --log-group-name <runner awslogs-group> --log-stream-names <prefix>/<container>/<task id> $p   (per chunk, up to 8 polls)"
    Write-Host "PLAN ONLY: no AWS call is made. Release $($Release.Commit) [$($Release.Variant)], phase $Phase."
    $i = 0; foreach ($l in $lines) { $i++; Write-Host ("{0,3}. {1}" -f $i, $l) }
}

# ---------------------------------------------------------------- main
Assert-SelfScan
if ($SelfTest) { Invoke-SelfTest; return }

$repo = Get-RepositoryState
if ($repo.Dirty.Count) { throw "Refusing: the working tree is not clean ($($repo.Dirty.Count) changes)." }
Write-Host "Checkout commit $($repo.Head) ($($repo.Branch)); release commit $ReleaseCommit; phase $Phase."
$kit = Get-Kit $repo.Head
$release = Get-ReleaseExpectation $ReleaseCommit
Write-Host "Kit sha256 $($kit.Sha256). Release migrations: $($release.Files.Count) files, 053 $((@($release.Files | Where-Object version -eq 53) | Select-Object -First 1).sha256), $($release.Variant)."
$chunks = Get-KitChunks $kit.Text 'bootstrap' $cfg.OverridesBudget
Assert-Chunks $kit $chunks
Write-Host "Kit chunks: $(@($chunks | ForEach-Object { "$($_.Id)=$($_.OverridesBytes)B" }) -join ', ') (limit $($cfg.OverridesLimit))."
if ($Plan) { Show-Plan $chunks $release; return }

$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'tracepoint-preflight-evidence' }
$evidence = Join-Path $EvidenceRoot "staging-$Phase-$stamp"
$fullEvidence = [IO.Path]::GetFullPath($evidence)
if ($fullEvidence.StartsWith([IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an evidence folder inside the repository.' }
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
function Save-Evidence([string]$Name, $Value) {
    $path = Join-Path $evidence $Name
    if ($Value -is [string]) { [IO.File]::WriteAllText($path, $Value, [Text.UTF8Encoding]::new($false)) }
    else { [IO.File]::WriteAllText($path, ($Value | ConvertTo-Json -Depth 60), [Text.UTF8Encoding]::new($false)) }
}

$script:AwsCli = Resolve-AwsCli
$checks = [System.Collections.Generic.List[object]]::new()
try {
    $profileConfig = Assert-NoProductionResolution
    $identity = Assert-Identity
    Write-Host "AWS identity $($identity.Arn)."
    Save-Evidence 'identity.json' ([pscustomobject]@{ arn = $identity.Arn; account = $identity.Account; profile = $cfg.Profile; profileConfig = $profileConfig })
    Save-Evidence 'git.json' ([pscustomobject]@{ checkoutCommit = $repo.Head; branch = $repo.Branch; kitSha256 = $kit.Sha256; release = $release })
    Save-Evidence 'kit-chunks.json' @($chunks | Select-Object -Property @('Id', 'FirstLine', 'LastLine', 'Bytes', 'Sha256', @{ n = 'GzipBase64Length'; e = { $_.GzipBase64.Length } }, 'OverridesBytes'))

    Write-Host 'Collecting ECS, ECR, RDS and notification evidence (read-only).'
    $ecs = Get-EcsEvidence; Save-Evidence 'ecs-service.json' $ecs
    $rds = Get-RdsEvidence; Save-Evidence 'rds.json' $rds
    $notify = Get-NotificationEvidence $ecs; Save-Evidence 'notification-delivery.json' $notify
    $primary = (@($ecs.service.deployments | Where-Object status -eq 'PRIMARY') | Select-Object -First 1)
    $checks.Add((New-Check 'ECS service steady' $(if (@($ecs.service.deployments).Count -eq 1 -and $primary -and $primary.rolloutState -eq 'COMPLETED') { 'PASS' } else { 'FAIL' }) "task definition $($ecs.service.taskDefinition); deployments $(@($ecs.service.deployments).Count); primary rollout $(if ($primary) { $primary.rolloutState })"))
    $cbOk = $null -ne $ecs.circuitBreaker -and $ecs.circuitBreaker.enable -eq $true -and $ecs.circuitBreaker.rollback -eq $true
    $checks.Add((New-Check 'Circuit breaker / rollback target' $(if ($cbOk) { 'PASS' } else { 'WARN' }) "enable=$(Get-Prop $ecs.circuitBreaker 'enable') rollback=$(Get-Prop $ecs.circuitBreaker 'rollback'); rollback restores $($ecs.rollbackTarget.primaryDeploymentTaskDefinition)"))
    $checks.Add((New-Check 'Running image -> previous app commit' $(if ($ecs.previousAppCommit) { 'PASS' } else { 'WARN' }) "commit $($ecs.previousAppCommit); images $(@($ecs.images | ForEach-Object { "$($_.digest) [$($_.tags -join ',')]" }) -join '; ')"))
    $checks.Add((New-Check 'RDS engine version' $(if ($rds.instance.engineVersion -eq $cfg.ExpectedEngine -and $rds.instance.status -eq 'available') { 'PASS' } else { 'FAIL' }) "$($rds.instance.engine) $($rds.instance.engineVersion) ($($rds.instance.status)); expected $($cfg.ExpectedEngine)"))
    $checks.Add((New-Check 'RDS snapshots' 'RECORDED' "latest: $(@($rds.latestSnapshots | Select-Object -First 3 | ForEach-Object { "$($_.id) $($_.status) $($_.created)" }) -join '; ')"))
    $checks.Add((New-Check 'Notification delivery disabled' $(if ($notify.disabled) { 'PASS' } elseif ($notify.invokersFound.Count) { 'FAIL' } else { 'UNVERIFIED' }) "invokers found $($notify.invokersFound.Count); unverified [$($notify.unverified -join '; ')]; mode=$($notify.runtime.notificationMode) provider=$($notify.runtime.emailProvider) schedules=$(@($notify.schedules).Count) rules=$(@($notify.eventBridgeRules).Count)"))

    if ($RunMigrateDbStatus) {
        # G2 through the existing path. Its database side is read-only (status
        # only reads the ledger). Its AWS side is not: it registers a new
        # runner revision every time and would build and push a migration image
        # when migration-<sha>-aws-native-staging is missing, so it only runs
        # when both images of the release commit already exist. The application
        # image <sha>-aws-native-staging is the one `deploy-app.ps1 staging
        # -PublishOnly` publishes; this script never runs that. migrate-db.ps1
        # judges its own HEAD, so it runs from a temporary detached worktree of
        # the release commit, removed afterwards.
        $appTag = "$ReleaseCommit-aws-native-staging"; $migTag = "migration-$ReleaseCommit-aws-native-staging"
        $appImage = Invoke-Aws @('ecr', 'describe-images', '--repository-name', $cfg.Repository, '--image-ids', "imageTag=$appTag") -AllowFailure
        $migImage = Invoke-Aws @('ecr', 'describe-images', '--repository-name', $cfg.Repository, '--image-ids', "imageTag=$migTag") -AllowFailure
        if (-not $appImage.Ok -or -not $migImage.Ok) {
            $checks.Add((New-Check 'G2 migrate-db.ps1 status' 'SKIPPED' "not run: $appTag present=$($appImage.Ok) (from deploy-app.ps1 staging -PublishOnly, separate owner approval), $migTag present=$($migImage.Ok). migrate-db.ps1 would refuse or build/push an image. G2 is evaluated from the kit ledger read below."))
        } else {
            $wt = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-preflight-release-' + [guid]::NewGuid().ToString('N'))
            if ((Invoke-GitText @('worktree', 'add', '--quiet', '--detach', $wt, $ReleaseCommit)).Code -ne 0) { throw "git worktree add of $ReleaseCommit failed." }
            try {
                Write-Host "Running scripts/migrate-db.ps1 staging -Action status at $ReleaseCommit (registers one runner revision)."
                $out = & (Join-Path $wt 'scripts/migrate-db.ps1') staging -Action status *>&1 | ForEach-Object { [string]$_ }
            } finally { [void](Invoke-GitText @('worktree', 'remove', '--force', $wt)) }
            Save-Evidence 'g2-migrate-db-status.txt' ($out -join [Environment]::NewLine)
            $taskArn = (@($out | ForEach-Object { if ($_ -match '(arn:aws:ecs:us-east-1:559054714699:task/\S+?);') { $Matches[1] } }) | Select-Object -First 1)
            $statusJson = $null
            if ($taskArn) {
                $t = (@((Invoke-Aws @('ecs', 'describe-tasks', '--cluster', $cfg.Cluster, '--tasks', $taskArn)).tasks) | Select-Object -First 1)
                $td = (Invoke-Aws @('ecs', 'describe-task-definition', '--task-definition', $t.taskDefinitionArn)).taskDefinition
                $c = (@($td.containerDefinitions) | Select-Object -First 1)
                $logs = Invoke-Aws @('logs', 'filter-log-events', '--log-group-name', $c.logConfiguration.options.'awslogs-group', '--log-stream-names', "$($c.logConfiguration.options.'awslogs-stream-prefix')/$($c.name)/$(($taskArn -split '/')[-1])") -AllowFailure
                if ($logs.Ok) { $statusJson = (@(Get-Prop $logs.Data 'events') | ForEach-Object { [string]$_.message } | Where-Object { $_ -match '^\{"ledger"' } | Select-Object -Last 1) }
            }
            if ($statusJson) { Save-Evidence 'g2-migrate-db-status.json' $statusJson; $s = $statusJson | ConvertFrom-Json; $pv = @($s.pending | ForEach-Object { [int]$_.version }) }
            $checks.Add((New-Check 'G2 migrate-db.ps1 status' $(if ($statusJson -and ($Phase -ne 'before' -or ($pv -join ',') -eq ($expectedPending -join ','))) { 'PASS' } else { 'FAIL' }) "task $taskArn; pending [$(if ($statusJson) { $pv -join ',' })]"))
        }
    } else { $checks.Add((New-Check 'G2 migrate-db.ps1 status' 'SKIPPED' 'Not requested (-RunMigrateDbStatus). G2 is evaluated from the kit ledger read below.')) }

    $runner = Get-RunnerRevision
    Save-Evidence 'runner-revision.json' $runner
    $chunks = Get-KitChunks $kit.Text $runner.container $cfg.OverridesBudget
    Assert-Chunks $kit $chunks
    $network = Get-NetworkArgument $ecs
    Write-Host "Runner revision $($runner.taskDefinitionArn) (image commit $($runner.imageCommit)); log group $($runner.logGroup)."
    [void](Assert-Identity)

    $runs = [System.Collections.Generic.List[object]]::new()
    $collect = {
        param($Chunk, $TaskArn, $Task)
        $got = Get-ChunkRecords $Chunk $TaskArn $runner
        $container = (@($Task.containers) | Select-Object -First 1)
        $run = [pscustomobject]@{ Chunk = $Chunk; TaskArn = $TaskArn; StopCode = (Get-Prop $Task 'stopCode'); ExitCode = (Get-Prop $container 'exitCode'); Stream = $got.Stream; Records = $got.Records }
        Save-Evidence "chunk-$($Chunk.Id).log" ($got.Messages -join "`n")
        Save-Evidence "chunk-$($Chunk.Id).json" ([pscustomobject]@{ id = $Chunk.Id; kitLines = "$($Chunk.FirstLine)-$($Chunk.LastLine)"; sha256 = $Chunk.Sha256; taskArn = $TaskArn; stopCode = $run.StopCode; exitCode = $run.ExitCode; logStream = $got.Stream; records = $got.Records })
        Save-Evidence "chunk-$($Chunk.Id).txt" (Format-Records $got.Records)
        return $run
    }
    Write-Host 'Kit canary (SESSION chunk).'
    $canary = (@($chunks | Where-Object Id -eq 'SESSION') | Select-Object -First 1)
    $arn = Start-ChunkTask $canary $runner $network
    $task = (@(Wait-Tasks @($arn)) | Select-Object -First 1)
    $run = & $collect $canary $arn $task; $runs.Add($run)
    $s = (@($run.Records | Where-Object t -eq 'session') | Select-Object -First 1)
    if ($null -eq $s -or $s.ro -ne 'on' -or $s.dro -ne 'on' -or $s.cu -ne 'tracepoint_migrator') { throw "Canary did not prove a read-only tracepoint_migrator session: $(Format-Records $run.Records)" }
    Write-Host "Canary: $($s.cu) on $($s.db), PostgreSQL $($s.sv), read-only $($s.ro)."

    $pendingChunks = @($chunks | Where-Object Id -ne 'SESSION')
    $started = @(foreach ($c in $pendingChunks) { [pscustomobject]@{ Chunk = $c; Arn = (Start-ChunkTask $c $runner $network) } })
    $stopped = Wait-Tasks @($started | ForEach-Object { $_.Arn })
    foreach ($st in $started) { $runs.Add((& $collect $st.Chunk $st.Arn ((@($stopped | Where-Object taskArn -eq $st.Arn) | Select-Object -First 1)))) }

    $all = @($runs | ForEach-Object { $_.Records })
    Save-Evidence 'kit-output.txt' ((@($runs | ForEach-Object { "######## chunk $($_.Chunk.Id) (kit lines $($_.Chunk.FirstLine)-$($_.Chunk.LastLine)) task $($_.TaskArn)`n" + (Format-Records $_.Records) })) -join "`n")
    $results = @(Get-LabelledResults $all)
    foreach ($c in (Test-KitResults $results $release $runs)) { $checks.Add($c) }
} catch {
    $checks.Add((New-Check 'procedure' 'FAIL' $_.Exception.Message))
    Write-Warning $_.Exception.Message
} finally {
    Save-Evidence 'aws-commands.txt' ($script:AwsLog -join [Environment]::NewLine)
}

$blocking = @($checks | Where-Object { $_.result -in @('FAIL', 'UNVERIFIED') })
$verdict = $(if ($blocking.Count -eq 0) { 'GO' } else { 'NO-GO' })
$summary = [pscustomobject]@{ verdict = $verdict; phase = $Phase; generatedAt = [DateTime]::UtcNow.ToString('o'); checkoutCommit = $repo.Head; releaseCommit = $ReleaseCommit; releaseVariant = $release.Variant; kitSha256 = $kit.Sha256; evidence = $fullEvidence; checks = $checks }
Save-Evidence 'summary.json' $summary
$text = ($checks | Format-Table -Property @('gate', 'result', 'detail') -AutoSize -Wrap | Out-String -Width 240) + "`n$verdict ($($blocking.Count) blocking). REVIEW/RECORDED rows need the operator's reading against README section 3.`nEvidence: $fullEvidence`n"
Save-Evidence 'summary.txt' $text
Write-Host $text
if ($verdict -ne 'GO') { exit 2 }
