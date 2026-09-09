import { NextResponse } from "next/server";
import { configuredSiteOrigin } from "@/lib/authentication/redirects";
import { createRuntimeCognitoTransport, isCognitoRuntimeEnabled } from "@/lib/authentication/cognito-runtime-transport";
import { createClient } from "@/lib/supabase/server";

export async function POST(request:Request){
 const origin=configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
 if(request.headers.get("origin")!==origin)return NextResponse.json({error:"Origin rejected."},{status:403,headers:{"Cache-Control":"no-store"}});
 if(isCognitoRuntimeEnabled()){
  const url=new URL(request.url);url.pathname="/api/auth/cognito/refresh";url.search="";
  return createRuntimeCognitoTransport().refresh(new Request(url,{method:"POST",headers:request.headers}));
 }
 const client=await createClient();const result=await client.auth.refreshSession();
 return result.error?NextResponse.json({error:"Sign in is required."},{status:401,headers:{"Cache-Control":"no-store"}}):new NextResponse(null,{status:204,headers:{"Cache-Control":"no-store"}});
}
