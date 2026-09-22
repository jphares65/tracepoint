import { NextResponse } from "next/server";

import { configuredSiteOrigin } from "@/lib/authentication/redirects";
import { createRuntimeCognitoTransport, isCognitoRuntimeEnabled } from "@/lib/authentication/cognito-runtime-transport";

function clearTracePointCookies(response: NextResponse) {
  for (const name of [
    "tracepoint_department_id",
    "tracepoint_support_department_id",
  ]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

export async function POST(request: Request) {
  if (isCognitoRuntimeEnabled()) {
    const url = new URL(request.url); url.pathname = "/api/auth/cognito/logout"; url.search = "";
    return createRuntimeCognitoTransport().logout(new Request(url, {method:"POST",headers:request.headers}));
  }
  const loginUrl = new URL('/login', configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL));
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  await supabase.auth.signOut();

  return clearTracePointCookies(
    NextResponse.redirect(loginUrl, { status: 303 }),
  );
}

export async function GET() {
  if (isCognitoRuntimeEnabled()) return NextResponse.json({error:"Sign out requires POST."},{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
  const loginUrl = new URL('/login', configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL));
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  await supabase.auth.signOut();

  return clearTracePointCookies(
    NextResponse.redirect(loginUrl),
  );
}
