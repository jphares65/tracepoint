import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";

function getSafeNextPath(value: string | null) {
  if (!value) return "/";

  try {
    const decoded = decodeURIComponent(value);

    if (!decoded.startsWith("/")) return "/";
    if (decoded.startsWith("//")) return "/";

    return decoded;
  } catch {
    if (!value.startsWith("/")) return "/";
    if (value.startsWith("//")) return "/";

    return value;
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createServerClient();

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
    }

    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set(
      "error",
      error.message || "Authentication link could not be confirmed.",
    );

    return NextResponse.redirect(loginUrl);
  }

  const errorDescription =
    requestUrl.searchParams.get("error_description") ||
    requestUrl.searchParams.get("error") ||
    "Authentication link could not be confirmed.";

  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", errorDescription);

  return NextResponse.redirect(loginUrl);
}