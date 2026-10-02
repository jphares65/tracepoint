import type {CognitoRedirectConfig} from './cognito-redirect-origin';
import {validatedCognitoOrigin} from './cognito-redirect-origin';
import {shadowCognitoDiagnostic,shadowCognitoDiagnosticsEnabled} from './cognito-shadow-diagnostic';
import {COGNITO_FLOW_LIFETIME_SECONDS,type CognitoTokens,type createCognitoPkce} from './cognito-pkce';
import {cognitoManagedLoginOrigin} from './cognito-endpoints';

type SessionReceipt={userId:string;handle:string;expiresAt:number};
type Pkce=ReturnType<typeof createCognitoPkce>;
export interface CognitoTransportPorts {
 pkce:Pkce;
 // These mandatory server ports must verify signed claims and commit durable
 // session/refresh state before issuing an opaque browser handle.
 establish(tokens:CognitoTokens,nonce:string):Promise<SessionReceipt>;
 rotate(handle:string):Promise<SessionReceipt>;
 revoke(handle:string):Promise<void>;
 inspectFlowForShadow?: (handle:string)=>Promise<{found:boolean;expired:boolean|null}>;
}
export const COGNITO_FLOW_COOKIE='__Host-tracepoint-cognito-flow';
export const COGNITO_SESSION_COOKIE='__Host-tracepoint-cognito-session';
const flowCookie=COGNITO_FLOW_COOKIE,sessionCookie=COGNITO_SESSION_COOKIE;
const handlePattern=/^[A-Za-z0-9_-]{43}$/;
export function inspectFlowCookie(request:Request,name=COGNITO_FLOW_COOKIE){
 const matches=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 const value=matches.length===1?matches[0].slice(name.length+1):'';
 return {present:matches.length>0,count:matches.length,empty:matches.length===1&&value.length===0,
  malformed:matches.length===1&&value.length>0&&!handlePattern.test(value),valid:matches.length===1&&handlePattern.test(value),
  handle:matches.length===1&&handlePattern.test(value)?value:null};
}
function readCookie(request:Request,name:string){
 const matches=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(matches.length!==1)throw Error();const value=matches[0].slice(name.length+1);if(!handlePattern.test(value))throw Error();return value;
}
const cookie=(name:string,value:string,maxAge:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Disabled route factory. No Next route or active provider imports this module.
// Opaque session receipts are the only browser credential; provider tokens stay
// within mandatory trusted server ports. This is not an in-memory session store.
export function createCognitoTransport(config:CognitoRedirectConfig,ports:CognitoTransportPorts,{enabled=false,now=Date.now}={}){
 if(config.region!=='us-east-1'||!/^\d{12}$/.test(config.account)||config.account==='265544358665'||
   (config.environment==='staging'?config.account!=='559054714699':config.environment!=='production'||['559054714699','111111111111'].includes(config.account))||
   !/^[A-Za-z0-9]{1,128}$/.test(config.clientId)||!/^us-east-1_[A-Za-z0-9]+$/.test(config.userPoolId))throw Error('Invalid Cognito transport target.');
 if(!ports?.pkce||typeof ports.establish!=='function'||typeof ports.rotate!=='function'||typeof ports.revoke!=='function')throw Error('Durable Cognito transport ports required.');
 const origin=validatedCognitoOrigin(config);
 const providerOrigin=cognitoManagedLoginOrigin(config.environment,config.account,config.region,config.rehearsalMode);
 function response(status:number,code:string,options:{location?:string;cookies?:string[]}={}){
  const headers=new Headers({'Cache-Control':'no-store, private','Pragma':'no-cache','Content-Type':'application/json','Referrer-Policy':'no-referrer'});
  if(options.location)headers.set('Location',options.location);for(const value of options.cookies??[])headers.append('Set-Cookie',value);
  return new Response(JSON.stringify({code}),{status,headers});
 }
 function guard(request:Request,path:string,method:string,csrf=true){
  if(!enabled)return response(503,'provider_disabled');const url=new URL(request.url);
  // Next may expose the ECS container origin in Request.url behind the shadow ALB.
  // Accept it only with the exact external HTTPS host attested by both proxy headers.
  const exactProxyHeaders=request.headers.get('host')===new URL(origin).host&&
   request.headers.get('x-forwarded-host')===new URL(origin).host&&
   request.headers.get('x-forwarded-proto')==='https';
  // ALB forwards the original Host and its TLS assertion, but does not add
  // X-Forwarded-Host. If an upstream does provide that header it must still
  // agree with the configured public host.
  const normalProxyHeaders=request.headers.get('host')===new URL(origin).host&&
   request.headers.get('x-forwarded-proto')==='https'&&
   [null,new URL(origin).host].includes(request.headers.get('x-forwarded-host'));
  const shadowProxyOrigin=config.notificationMode==='shadow'&&
   (url.hostname==='0.0.0.0'||/^ip-(?:\d{1,3}-){3}\d{1,3}\.ec2\.internal$/.test(url.hostname))&&
   url.protocol==='https:'&&url.port==='3000'&&
   exactProxyHeaders;
  // The normal ALB terminates TLS and forwards HTTP to the private ECS
  // container. Next can expose that internal hop in Request.url. This exception
  // is valid only with the exact external Host and HTTPS proxy assertions; the
  // separate CSRF Origin check below still requires the normal site origin.
  const normalProxyOrigin=config.notificationMode==='normal'&&normalProxyHeaders&&
   ((url.hostname==='0.0.0.0'&&url.port==='3000'&&
     (url.protocol==='http:'||url.protocol==='https:'))||
    (config.environment==='production'&&url.origin==='http://tracepointhq.com')||
    (config.environment==='staging'&&(url.origin==='http://staging.tracepointhq.com'||
     (url.port==='3000'&&(url.protocol==='http:'||url.protocol==='https:')&&
      /^ip-10-40-[01]-\d{1,3}\.ec2\.internal$/.test(url.hostname)))));
  if((url.origin!==origin&&!shadowProxyOrigin&&!normalProxyOrigin)||url.pathname!==path){
   if(config.notificationMode==='shadow'||config.environment==='staging')console.warn(JSON.stringify({event:config.notificationMode==='shadow'?'shadow-cognito-request-mismatch':'staging-cognito-request-mismatch',
    actualOrigin:url.origin,expectedOrigin:origin,pathMatches:url.pathname===path,
    host:request.headers.get('host'),forwardedHost:request.headers.get('x-forwarded-host'),
    forwardedProto:request.headers.get('x-forwarded-proto'),forwardedPort:request.headers.get('x-forwarded-port')}));
   return response(400,'invalid_request');
  }
  if(request.method!==method)return response(405,'method_not_allowed');
  if(csrf&&(request.headers.get('origin')!==origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||url.search))return response(403,'origin_rejected');
  return null;
 }
 function session(value:SessionReceipt){
  const seconds=Math.floor(now()/1000);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value?.userId)||!handlePattern.test(value.handle)||!Number.isInteger(value.expiresAt)||value.expiresAt<=seconds||value.expiresAt>seconds+86400)throw Error();
  return cookie(sessionCookie,value.handle,value.expiresAt-seconds);
 }
 return {
  async begin(request:Request){
   const rejected=guard(request,'/api/auth/cognito/login','POST');if(rejected)return rejected;
   try{const flow=await ports.pkce.begin(),url=new URL(flow.url);
    if(url.origin!==providerOrigin||url.pathname!=='/oauth2/authorize'||url.searchParams.get('client_id')!==config.clientId||url.searchParams.get('redirect_uri')!==origin+'/api/auth/cognito/callback'||flow.cookie.name!==flowCookie||!handlePattern.test(flow.cookie.value)||flow.cookie.maxAge!==COGNITO_FLOW_LIFETIME_SECONDS)throw Error();
    shadowCognitoDiagnostic('flow_cookie_set',{secure:true,httpOnly:true,sameSiteLax:true,pathRoot:true,hostOnly:true,maxAgeSeconds:COGNITO_FLOW_LIFETIME_SECONDS,setCookieCount:1,
     requestHostShadow:request.headers.get('host')===new URL(origin).host,forwardedHostShadow:request.headers.get('x-forwarded-host')===new URL(origin).host,forwardedProtoHttps:request.headers.get('x-forwarded-proto')==='https'});
    return response(303,'authorization_started',{location:flow.url,cookies:[cookie(flowCookie,flow.cookie.value,flow.cookie.maxAge)]});
   }catch{return response(503,'authorization_unavailable');}
  },
  async callback(request:Request){
   const rejected=guard(request,'/api/auth/cognito/callback','GET',false);if(rejected)return rejected;
   const cleared=cookie(flowCookie,'',0);
   let branch='callback_parameters';
   try{const url=new URL(request.url);if(url.searchParams.has('error')||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1)throw Error();
    let established:SessionReceipt|undefined;
    branch='flow_cookie';
    if(shadowCognitoDiagnosticsEnabled()){
     const inspection=inspectFlowCookie(request,flowCookie);
     let transactionFound:boolean|null=null,transactionExpired:boolean|null=null;
     if(inspection.handle&&ports.inspectFlowForShadow){
      try{const status=await ports.inspectFlowForShadow(inspection.handle);transactionFound=status.found;transactionExpired=status.expired;}catch{/* Diagnostics must not change authentication behavior. */}
     }
     shadowCognitoDiagnostic('flow_cookie_observed',{cookiePresent:inspection.present,matchingCount:inspection.count,
      valueEmpty:inspection.empty,valueMalformed:inspection.malformed,validHandle:inspection.valid,
      transactionFound,transactionExpired,
      requestHostShadow:request.headers.get('host')===new URL(origin).host,
      forwardedHostShadow:request.headers.get('x-forwarded-host')===new URL(origin).host,
      forwardedProtoHttps:request.headers.get('x-forwarded-proto')==='https',
      requestUrlShadow:new URL(request.url).origin===origin});
    }
    const handle=readCookie(request,flowCookie);
    branch='pkce_completion';const identity=await ports.pkce.complete({handle,state:url.searchParams.get('state')!,code:url.searchParams.get('code')!},async(tokens,nonce)=>{
     branch='session_establishment';const result=await ports.establish(tokens,nonce);
     branch='session_receipt_validation';session(result);established=result;return {userId:result.userId};
    });
    branch='identity_receipt_match';if(!established||identity.userId!==established.userId)throw Error();
    branch='session_cookie';shadowCognitoDiagnostic('callback_success');
    return response(303,'authenticated',{location:origin+'/',cookies:[cleared,session(established)]});
   }catch{shadowCognitoDiagnostic(branch);return response(401,'authorization_rejected',{cookies:[cleared]});}
  },
  async refresh(request:Request){
   const rejected=guard(request,'/api/auth/cognito/refresh','POST');if(rejected)return rejected;
   try{const receipt=await ports.rotate(readCookie(request,sessionCookie));return response(200,'session_refreshed',{cookies:[session(receipt)]});}
   catch{return response(401,'sign_in_required',{cookies:[cookie(sessionCookie,'',0)]});}
  },
  async logout(request:Request){
   const rejected=guard(request,'/api/auth/cognito/logout','POST');if(rejected)return rejected;
   // Match the bridge sign-out contract: a new multi-agency login must choose
   // its agency instead of inheriting the previous session's tenant selection.
   const cleared=[cookie(sessionCookie,'',0),cookie(flowCookie,'',0),
    cookie('tracepoint_department_id','',0),cookie('tracepoint_support_department_id','',0)];
   try{await ports.revoke(readCookie(request,sessionCookie));const url=new URL(providerOrigin+'/logout');url.search=new URLSearchParams({client_id:config.clientId,logout_uri:origin+'/login'}).toString();return response(303,'signed_out',{location:url.toString(),cookies:cleared});}
   catch{return response(503,'logout_unconfirmed',{cookies:cleared});}
  },
 };
}
