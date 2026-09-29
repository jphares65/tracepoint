param([string] $Profile = 'tracepoint-production')
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$account = '193644343389'
$identity = aws sts get-caller-identity --profile $Profile --region $region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $account) { throw 'AWS_ACCOUNT_MISMATCH' }
$service = (aws ecs describe-services --cluster tracepoint-production --services tracepoint-production --profile $Profile --region $region --output json | ConvertFrom-Json).services[0]
if ($LASTEXITCODE -ne 0 -or $service.status -ne 'ACTIVE' -or $service.runningCount -ne 1 -or $service.desiredCount -ne 1) { throw 'PRODUCTION_SERVICE_NOT_STABLE' }
$appTask = (aws ecs describe-task-definition --task-definition $service.taskDefinition --profile $Profile --region $region --output json | ConvertFrom-Json).taskDefinition
$task = (aws ecs describe-task-definition --task-definition 'tracepoint-production-final-relational-import-20260928:2' --profile $Profile --region $region --output json | ConvertFrom-Json).taskDefinition
if ($LASTEXITCODE -ne 0 -or $appTask.containerDefinitions.Count -ne 1 -or $appTask.containerDefinitions[0].name -ne 'tracepoint' -or
  $task.executionRoleArn -ne "arn:aws:iam::$account`:role/TracePoint-ProductionFinalImportExec-20260928" -or
  $task.containerDefinitions[0].secrets[0].valueFrom -ne "arn:aws:secretsmanager:$region`:$account`:secret:tracepoint/production/database/migrator-8X57JT") { throw 'MIGRATOR_TASK_DEFINITION_MISMATCH' }
$expectedImage = $appTask.containerDefinitions[0].image
if ($expectedImage -notmatch "^$account\.dkr\.ecr\.$region\.amazonaws\.com/tracepoint-production@sha256:[0-9a-f]{64}$") { throw 'IMAGE_NOT_PINNED' }
$script = @'
const {Client}=require('pg');
const {readFileSync}=require('fs');
const assert=require('assert/strict');
const secret=JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON||'{}');
delete process.env.TARGET_DATABASE_SECRET_JSON;
assert.equal(secret.host,'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com');
assert.equal(secret.dbname,'tracepoint');
assert.equal(secret.username,'tracepoint_migrator');
const host='tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const db=new Client({host,port:5432,database:secret.dbname,user:secret.username,password:secret.password,ssl:{ca:readFileSync('/app/rds-ca.pem','utf8'),rejectUnauthorized:true,servername:host},connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'tracepoint-platform-admin-readonly-probe'});
(async()=>{await db.connect();try{await db.query('begin read only');
const r=await db.query(`select p.id,p.email,l.subject,l.state,pa.is_active as platform_active,
 (select count(*)::int from public.department_memberships m where m.user_id=p.id and m.is_active=true) as active_memberships,
 (select count(*)::int from public.authentication_identity_links x where x.provider='cognito' and x.issuer=l.issuer and x.subject=l.subject) as subject_link_count
 from public.profiles p join public.authentication_identity_links l on l.tracepoint_user_id=p.id
 left join public.platform_admins pa on pa.user_id=p.id
 where lower(p.email)=lower($1) and l.provider='cognito' and l.issuer=$2`,['admin@tracepointhq.com','https://cognito-idp.us-east-1.amazonaws.com/us-east-1_diFmWDMe9']);
assert.equal(r.rowCount,1,'IDENTITY_NOT_UNIQUE');
await db.query('set local role authenticated');
await db.query("select set_config('tracepoint.subject_id',$1,true)",[r.rows[0].id]);
const scoped=await db.query(`select public.is_platform_admin() as platform_admin,
 exists(select 1 from public.department_memberships where user_id=$1 and is_active=true) as has_active_membership`,[r.rows[0].id]);
await db.query('commit');const rows=r.rows.map(x=>({appUserId:x.id,email:x.email,subjectMatches:x.subject==='c4d8c448-c011-7060-4e11-8108c3ebacaa',linkState:x.state,platformActive:x.platform_active===true,activeMemberships:x.active_memberships,subjectLinkCount:x.subject_link_count}));console.log(JSON.stringify({probe:'platform-admin-readonly',rows,subjectBoundPlatformAdmin:scoped.rows[0]?.platform_admin===true,subjectBoundMembership:scoped.rows[0]?.has_active_membership===true}));
}catch(e){await db.query('rollback').catch(()=>{});throw e;}finally{await db.end();}})().catch(e=>{console.error('PROBE_FAILED',e.code||e.message);process.exitCode=1});
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
$definition = @{
  family = 'tracepoint-production-platform-admin-readonly-probe-20260929'
  taskRoleArn = $task.taskRoleArn
  executionRoleArn = $task.executionRoleArn
  networkMode = 'awsvpc'
  requiresCompatibilities = @('FARGATE')
  cpu = '512'
  memory = '1024'
  containerDefinitions = @(@{
    name = 'platform-admin-readonly-probe'
    image = $expectedImage
    essential = $true
    entryPoint = @('/nodejs/bin/node')
    command = @('-e', "eval(Buffer.from('$encoded','base64').toString('utf8'))")
    secrets = @(@{ name = 'TARGET_DATABASE_SECRET_JSON'; valueFrom = $task.containerDefinitions[0].secrets[0].valueFrom })
    logConfiguration = @{ logDriver = 'awslogs'; options = @{
      'awslogs-group' = '/tracepoint/production/final-import-20260928'
      'awslogs-region' = $region
      'awslogs-stream-prefix' = 'platform-admin-readonly'
    } }
  })
}
$payload = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-platform-readonly-' + [guid]::NewGuid().ToString('N') + '.json')
$registered = $null
try {
  [IO.File]::WriteAllText($payload, ($definition | ConvertTo-Json -Depth 30 -Compress), [Text.UTF8Encoding]::new($false))
  $registered = (aws ecs register-task-definition --cli-input-json ('file://' + $payload.Replace('\','/')) --profile $Profile --region $region --output json | ConvertFrom-Json).taskDefinition.taskDefinitionArn
  if ($LASTEXITCODE -ne 0 -or !$registered) { throw 'READONLY_TASK_REGISTRATION_FAILED' }
  $network = $service.networkConfiguration.awsvpcConfiguration
  $networkArg = "awsvpcConfiguration={subnets=[$($network.subnets -join ',')],securityGroups=[$($network.securityGroups -join ',')],assignPublicIp=$($network.assignPublicIp)}"
  $result = aws ecs run-task --cluster tracepoint-production --task-definition $registered --launch-type FARGATE --network-configuration $networkArg --profile $Profile --region $region --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $result.failures.Count -gt 0 -or $result.tasks.Count -ne 1) { throw 'READONLY_PROBE_START_FAILED' }
  $arn = $result.tasks[0].taskArn
  aws ecs wait tasks-stopped --cluster tracepoint-production --tasks $arn --profile $Profile --region $region
  if ($LASTEXITCODE -ne 0) { throw 'READONLY_PROBE_WAIT_FAILED' }
  $finished = (aws ecs describe-tasks --cluster tracepoint-production --tasks $arn --profile $Profile --region $region --output json | ConvertFrom-Json).tasks[0]
  $stream = 'platform-admin-readonly/platform-admin-readonly-probe/' + $finished.taskArn.Split('/')[-1]
  $log = aws logs get-log-events --log-group-name '/tracepoint/production/final-import-20260928' --log-stream-name $stream --profile $Profile --region $region --query 'events[].message' --output text
  [pscustomobject]@{ taskArn=$arn; exitCode=$finished.containers[0].exitCode; output=$log } | ConvertTo-Json -Compress
  if ($finished.containers[0].exitCode -ne 0) { throw 'READONLY_PROBE_FAILED' }
} finally {
  if ($registered) { aws ecs deregister-task-definition --task-definition $registered --profile $Profile --region $region --query 'taskDefinition.status' --output text | Out-Null }
  Remove-Item -LiteralPath $payload -ErrorAction SilentlyContinue
}
