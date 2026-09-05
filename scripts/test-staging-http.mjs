const base='https://staging.tracepointhq.com';
const session=process.env.TRACEPOINT_STAGING_SESSION_COOKIE;
const routes=['/api/access','/api/settings/current-rules','/api/qualifications','/api/training/certification-types','/api/agency-training/courses','/api/equipment/assets','/api/equipment/requirements','/api/equipment/types'];
let failed=false;
for(const route of ['/login','/api/health',...routes]){
 let ok=false;let status;
 try{
  const publicRoute=['/login','/api/health'].includes(route);
  const r=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:!publicRoute&&session?{cookie:session}:{}});status=r.status;
  if(publicRoute||session)ok=status===200;
  else if([302,303,307,308].includes(status)) {const target=new URL(r.headers.get('location'),base);ok=target.origin===base&&target.pathname==='/login';}
  else ok=[401,403].includes(status);
 }catch{ok=false;}
 console.log(JSON.stringify({route,status,ok}));failed ||= !ok;
}
process.exitCode=failed?1:0;
