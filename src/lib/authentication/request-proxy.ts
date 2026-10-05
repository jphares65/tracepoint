import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthenticatedPrincipal } from "./request-session";
import { resolveLoginSession } from "./login-session-core";
import { isAwsNativePublicPath, loginRedirectTarget, sessionExpiryRedirectTarget } from "./request-proxy-core";
import { InvalidApplicationSessionCookieError } from "./request-session-core";
import { clearLocalSessionState, withoutLocalSessionCookies } from "./session-cleanup";
import { shouldRouteToPlatformConsole } from "./post-auth-routing-core";
import { resolvePostgresPlatformLanding } from "@/lib/tracepoint/server-access-postgres";

const noStore={"Cache-Control":"no-store, private",Pragma:"no-cache"};
const isApi=(pathname:string)=>pathname.toLowerCase().startsWith("/api/");

function signInRequiredResponse(request: NextRequest, clearLocalState = false) {
 const pathname=request.nextUrl.pathname;
 const target = sessionExpiryRedirectTarget(pathname,request.nextUrl.search);
 const response = isApi(pathname)
  ? NextResponse.json({error:"Authentication is required."},{status:401,headers:noStore})
  : target===null
   ? NextResponse.next({request})
   : NextResponse.redirect(new URL(target,request.url));
 return clearLocalState ? clearLocalSessionState(response) : response;
}

function cleanLoginResponse(request: NextRequest) {
 const headers = new Headers(request.headers);
 const cookie = withoutLocalSessionCookies(headers.get("cookie"));
 if (cookie) headers.set("cookie", cookie);
 else headers.delete("cookie");
 return clearLocalSessionState(NextResponse.next({ request: { headers } }));
}

export async function updateAwsNativeSession(
 request:NextRequest,
 resolvePrincipal: typeof resolveAuthenticatedPrincipal = resolveAuthenticatedPrincipal,
){
 const pathname=request.nextUrl.pathname;
 const isLogin=pathname.toLowerCase()==="/login";
 if(isAwsNativePublicPath(pathname)&&!isLogin)return NextResponse.next({request});
 if(isLogin){
  const loginSession=await resolveLoginSession(() => resolvePrincipal(request.headers.get("cookie")));
  if(loginSession.requiresCleanup)return cleanLoginResponse(request);
  return NextResponse.redirect(new URL(loginRedirectTarget(request.nextUrl.search),request.url));
 }
 let principal;
 try{principal=await resolvePrincipal(request.headers.get("cookie"));}
 catch(error){
  if(error instanceof InvalidApplicationSessionCookieError)return signInRequiredResponse(request,true);
  return NextResponse.json({error:"TracePoint session verification is unavailable."},{status:503,headers:noStore});
 }
 if(!principal){
  return signInRequiredResponse(request,true);
 }
 if(pathname==="/"){
  try{
   const landing=await resolvePostgresPlatformLanding(principal);
   if(shouldRouteToPlatformConsole(landing))return NextResponse.redirect(new URL("/platform",request.url),{headers:noStore});
  }catch{return NextResponse.json({error:"TracePoint access verification is unavailable."},{status:503,headers:noStore});}
 }
 return NextResponse.next({request});
}
