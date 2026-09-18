import type {CognitoVerificationConfig} from './cognito-verifier';
import type {CognitoTokens,createCognitoPkce} from './cognito-pkce';

type SessionReceipt={userId:string;handle:string;expiresAt:number};
type Pkce=ReturnType<typeof createCognitoPkce>;
export interface CognitoTransportPorts {
 pkce:Pkce;
 // These mandatory server ports must verify signed claims and commit durable
 // session/refresh state before issuing an opaque browser handle.
 establish(tokens:CognitoTokens,nonce:string):Promise<SessionReceipt>;
 rotate(handle:string):Promise<SessionReceipt>;
 revoke(handle:string):Promise<void>;
}
export const COGNITO_FLOW_COOKIE='__Host-tracepoint-cognito-flow';
export const COGNITO_SESSION_COOKIE='__Host-tracepoint-cognito-session';
const flowCookie=COGNITO_FLOW_COOKIE,sessionCookie=COGNITO_SESSION_COOKIE;
const handlePattern=/^[A-Za-z0-9_-]{43}$/;
function readCookie(request:Request,name:string){
 const matches=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(matches.length!==1)throw Error();const value=matches[0].slice(name.length+1);if(!handlePattern.test(value))throw Error();return value;
}
const cookie=(name:string,value:string,maxAge:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Disabled route factory. No Next route or active provider imports this module.
// Opaque session receipts are the only browser credential; provider tokens stay
// within mandatory trusted server ports. This is not an in-memory session store.
export function createCognitoTransport(config:CognitoVerificationConfig,ports:CognitoTransportPorts,{enabled=false,now=Date.now}={}){
 if(config.region!=='us-east-1'||!/^\d{12}$/.test(config.account)||config.account==='265544358665'||
   (config.environment==='staging'?config.account!=='559054714699':config.environment!=='production'||['559054714699','111111111111'].includes(config.account))||
   !/^[A-Za-z0-9]{1,128}$/.test(config.clientId)||!/^us-east-1_[A-Za-z0-9]+$/.test(config.userPoolId))throw Error('Invalid Cognito transport target.');
 if(!ports?.pkce||typeof ports.establish!=='function'||typeof ports.rotate!=='function'||typeof ports.revoke!=='function')throw Error('Durable Cognito transport ports required.');
 const origin=config.environment==='staging'?'https://staging.tracepointhq.com':'https://tracepointhq.com';
 const providerOrigin=`https://tracepoint-${config.environment}-${config.account}.auth.us-east-1.amazoncognito.com`;
 function response(status:number,code:string,options:{location?:string;cookies?:string[]}={}){
  const headers=new Headers({'Cache-Control':'no-store, private','Pragma':'no-cache','Content-Type':'application/json','Referrer-Policy':'no-referrer'});
  if(options.location)headers.set('Location',options.location);for(const value of options.cookies??[])headers.append('Set-Cookie',value);
  return new Response(JSON.stringify({code}),{status,headers});
 }
 function guard(request:Request,path:string,method:string,csrf=true){
  if(!enabled)return response(503,'provider_disabled');const url=new URL(request.url);
  if(url.origin!==origin||url.pathname!==path)return response(400,'invalid_request');
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
   try{const body=await request.text();if(body.length>4096)throw Error();const params=new URLSearchParams(body);if(params.getAll('next').length>1)throw Error();const returnTo=params.get('next')||'/';const flow=await ports.pkce.begin(returnTo),url=new URL(flow.url);
    if(url.origin!==providerOrigin||url.pathname!=='/oauth2/authorize'||url.searchParams.get('client_id')!==config.clientId||url.searchParams.get('redirect_uri')!==origin+'/api/auth/cognito/callback'||flow.cookie.name!==flowCookie||!handlePattern.test(flow.cookie.value))throw Error();
    return response(303,'authorization_started',{location:flow.url,cookies:[cookie(flowCookie,flow.cookie.value,300)]});
   }catch{return response(503,'authorization_unavailable');}
  },
  async callback(request:Request){
   const rejected=guard(request,'/api/auth/cognito/callback','GET',false);if(rejected)return rejected;
   const cleared=cookie(flowCookie,'',0);
   try{const url=new URL(request.url);if(url.searchParams.has('error')||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1)throw Error();
    let established:SessionReceipt|undefined;
    const identity=await ports.pkce.complete({handle:readCookie(request,flowCookie),state:url.searchParams.get('state')!,code:url.searchParams.get('code')!},async(tokens,nonce)=>{
     const result=await ports.establish(tokens,nonce);session(result);established=result;return {userId:result.userId};
    });
    if(!established||identity.userId!==established.userId)throw Error();
    return response(303,'authenticated',{location:origin+identity.returnTo,cookies:[cleared,session(established)]});
   }catch{return response(401,'authorization_rejected',{cookies:[cleared]});}
  },
  async refresh(request:Request){
   const rejected=guard(request,'/api/auth/cognito/refresh','POST');if(rejected)return rejected;
   try{const receipt=await ports.rotate(readCookie(request,sessionCookie));return response(200,'session_refreshed',{cookies:[session(receipt)]});}
   catch{return response(401,'sign_in_required',{cookies:[cookie(sessionCookie,'',0)]});}
  },
  async logout(request:Request){
   const rejected=guard(request,'/api/auth/cognito/logout','POST');if(rejected)return rejected;
   const cleared=[cookie(sessionCookie,'',0),cookie(flowCookie,'',0),cookie('tracepoint_department_id','',0),cookie('tracepoint_support_department_id','',0)];
   try{await ports.revoke(readCookie(request,sessionCookie));const url=new URL(providerOrigin+'/logout');url.search=new URLSearchParams({client_id:config.clientId,logout_uri:origin+'/login'}).toString();return response(303,'signed_out',{location:url.toString(),cookies:cleared});}
   catch{return response(503,'logout_unconfirmed',{cookies:cleared});}
  },
 };
}
