import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthenticatedPrincipal } from "./request-session";
import { isAwsNativePublicPath, sessionExpiryRedirectTarget } from "./request-proxy-core";
import { InvalidApplicationSessionCookieError } from "./request-session-core";
import { clearLocalSessionState } from "./session-cleanup";
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

export async function updateAwsNativeSession(request:NextRequest){
 const pathname=request.nextUrl.pathname;
 // Login must still inspect a durable receipt. A stale receipt is cleared here,
 // while a valid receipt is left for the login page's existing redirect logic.
 if(isAwsNativePublicPath(pathname)&&pathname!=="/login")return NextResponse.next({request});
 let principal;
 try{principal=await resolveAuthenticatedPrincipal(request.headers.get("cookie"));}
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
