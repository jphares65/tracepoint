import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/auth/setup";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeNextPath(
    request.nextUrl.searchParams.get("next"),
  );

  if (!code) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "error",
      "The sign-in link was incomplete or has expired.",
    );

    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("error", error.message);

    return NextResponse.redirect(loginUrl);
  }

  const destination = request.nextUrl.clone();
  destination.pathname = nextPath.split("?")[0] || "/auth/setup";
  destination.search = nextPath.includes("?")
    ? `?${nextPath.split("?").slice(1).join("?")}`
    : "";

  return NextResponse.redirect(destination);
}
