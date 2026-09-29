param([string] $Profile = 'tracepoint-production')
$ErrorActionPreference = 'Stop'
$region = 'us-east-1'
$cluster = 'tracepoint-production'
$service = 'tracepoint-production-native-authority-rehearsal'
$expectedTaskDefinition = 'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepoint-production-aws-native-no-traffic-proof:1'
$tasks = @(aws ecs list-tasks --cluster $cluster --service-name $service --desired-status RUNNING --profile $Profile --region $region --query 'taskArns' --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $tasks.Count -ne 1) { throw 'PRIVATE_CANDIDATE_TASK_COUNT_MISMATCH' }
$candidate = (aws ecs describe-tasks --cluster $cluster --tasks $tasks[0] --profile $Profile --region $region --output json | ConvertFrom-Json).tasks[0]
if ($LASTEXITCODE -ne 0 -or $candidate.lastStatus -ne 'RUNNING' -or
    $candidate.taskDefinitionArn -ne $expectedTaskDefinition) { throw 'PRIVATE_CANDIDATE_IDENTITY_MISMATCH' }
$ip = @($candidate.attachments[0].details | Where-Object name -eq 'privateIPv4Address')[0].value
if ($ip -notmatch '^10\.40\.\d{1,3}\.\d{1,3}$') { throw 'PRIVATE_CANDIDATE_IP_UNEXPECTED' }
$image = '193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@sha256:89ef6188d0bce79a741a3cf53b2d59826cd2491710c20d81dc6d3f90c2564cef'
$execution = 'arn:aws:iam::193644343389:role/TracePoint-ProductionFinalImportExec-20260928'
$code = @'
const assert=require('node:assert/strict');
console.log('PRIVATE_PROBE_STARTED');
(async()=>{
  const ip=process.env.TRACEPOINT_PRIVATE_TARGET_IP;
  assert.match(ip??'',/^10\.40\.\d{1,3}\.\d{1,3}$/);
  const request=async path=>fetch(`http://${ip}:3000${path}`,{headers:{Host:'tracepointhq.com'},redirect:'manual',signal:AbortSignal.timeout(8000)});
  const health=await request('/api/health');
  assert.equal(health.status,200,'PRIVATE_HEALTH_STATUS');
  const body=await health.json();
  assert.equal(body.status,'ok','PRIVATE_HEALTH_BODY');
  const protectedResponse=await request('/api/settings/audit-log');
  assert.ok([302,303,307,308,401,403].includes(protectedResponse.status),'PRIVATE_UNAUTHENTICATED_ROUTE_NOT_DENIED');
  const login=await fetch(`http://${ip}:3000/api/auth/cognito/login`,{method:'POST',headers:{
    Host:'tracepointhq.com',Origin:'https://tracepointhq.com','X-Forwarded-Host':'tracepointhq.com',
    'X-Forwarded-Proto':'https','Sec-Fetch-Site':'same-origin'
  },redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(login.status!==303){let code='non_json';try{code=(await login.json()).code??'missing_code'}catch{};console.log(JSON.stringify({status:'PRIVATE_LOGIN_START_REJECTED',http:login.status,code}));}
  assert.equal(login.status,303,'PRIVATE_LOGIN_START_STATUS');
  const redirect=new URL(login.headers.get('location'));
  assert.equal(redirect.protocol,'https:','PRIVATE_LOGIN_REDIRECT_TLS');
  assert.equal(redirect.searchParams.get('client_id'),'9tfp383dgjuvanhnh94bstafr','PRIVATE_LOGIN_CLIENT_MISMATCH');
  assert.equal(redirect.searchParams.get('redirect_uri'),'https://tracepointhq.com/api/auth/cognito/callback','PRIVATE_LOGIN_CALLBACK_MISMATCH');
  console.log(JSON.stringify({status:'PRIVATE_NATIVE_HTTP_PASS',health:200,protectedRoute:protectedResponse.status,loginStart:303,publicRoute:false}));
})().catch(error=>{console.error(JSON.stringify({status:'PRIVATE_NATIVE_HTTP_FAILED',code:/^[A-Z_]+$/.test(error.message)?error.message:'FAIL_CLOSED',class:error.name}));process.exitCode=1});
'@
$definition = @{
  family = 'tracepoint-production-private-native-http-probe-20260928'
  executionRoleArn = $execution
  networkMode = 'awsvpc'
  requiresCompatibilities = @('FARGATE')
  cpu = '256'
  memory = '512'
  containerDefinitions = @(@{
    name = 'private-http-probe'
    image = $image
    essential = $true
    entryPoint = @('node', '-e')
    command = @($code)
    environment = @(@{ name = 'TRACEPOINT_PRIVATE_TARGET_IP'; value = $ip })
    logConfiguration = @{ logDriver = 'awslogs'; options = @{
      'awslogs-group' = '/tracepoint/production/final-import-20260928'
      'awslogs-region' = $region
      'awslogs-stream-prefix' = 'private-http'
    } }
  })
}
$file = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-private-probe-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  [IO.File]::WriteAllText($file, ($definition | ConvertTo-Json -Depth 30 -Compress), [Text.UTF8Encoding]::new($false))
  $registered = aws ecs register-task-definition --cli-input-json ('file://' + $file.Replace('\', '/')) --profile $Profile --region $region --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $registered.taskDefinition.family -ne $definition.family) { throw 'PRIVATE_PROBE_REGISTRATION_FAILED' }
  $launched = aws ecs run-task --cluster $cluster --task-definition $registered.taskDefinition.taskDefinitionArn --launch-type FARGATE --count 1 --network-configuration 'awsvpcConfiguration={subnets=[subnet-0f4cbed3e60d90bfc],securityGroups=[sg-0a7ba07ccc254d6b6,sg-0d325549024a77f4a],assignPublicIp=ENABLED}' --profile $Profile --region $region --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or @($launched.failures).Count -ne 0 -or @($launched.tasks).Count -ne 1) { throw 'PRIVATE_PROBE_LAUNCH_FAILED' }
  [pscustomobject]@{ taskArn=$launched.tasks[0].taskArn; candidateTask=$tasks[0]; targetPrivateIp=$ip; publicRoute=$false } | ConvertTo-Json -Compress
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
