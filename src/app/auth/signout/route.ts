import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

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

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";

  return clearTracePointCookies(
    NextResponse.redirect(loginUrl, { status: 303 }),
  );
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";

  return clearTracePointCookies(
    NextResponse.redirect(loginUrl),
  );
}
