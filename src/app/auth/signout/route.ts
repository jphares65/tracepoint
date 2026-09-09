import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { configuredSiteOrigin } from "@/lib/authentication/redirects";

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

export async function POST() {
  const loginUrl = new URL('/login', configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL));
  const supabase = await createClient();
  await supabase.auth.signOut();

  return clearTracePointCookies(
    NextResponse.redirect(loginUrl, { status: 303 }),
  );
}

export async function GET() {
  const loginUrl = new URL('/login', configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL));
  const supabase = await createClient();
  await supabase.auth.signOut();

  return clearTracePointCookies(
    NextResponse.redirect(loginUrl),
  );
}
