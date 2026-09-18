import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthenticatedPrincipal } from "./request-session";
import { isAwsNativePublicPath, safeRequestedPath } from "./request-proxy-core";

const noStore={"Cache-Control":"no-store, private",Pragma:"no-cache"};
const isApi=(pathname:string)=>pathname.toLowerCase().startsWith("/api/");
export async function updateAwsNativeSession(request:NextRequest){
 const pathname=request.nextUrl.pathname;
 if(isAwsNativePublicPath(pathname))return NextResponse.next({request});
 let principal;
 try{principal=await resolveAuthenticatedPrincipal(request.headers.get("cookie"));}
 catch{return NextResponse.json({error:"TracePoint session verification is unavailable."},{status:503,headers:noStore});}
 if(!principal){
  if(isApi(pathname))return NextResponse.json({error:"Authentication is required."},{status:401,headers:noStore});
  if(pathname==="/")return NextResponse.redirect(new URL("/landing",request.url));
  const login=new URL("/login",request.url);login.searchParams.set("next",safeRequestedPath(pathname,request.nextUrl.search));return NextResponse.redirect(login);
 }
 return NextResponse.next({request});
}
