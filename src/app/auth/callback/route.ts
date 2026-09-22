import {internalAuthRedirect,configuredSiteOrigin} from '@/lib/authentication/redirects';
﻿import { NextRequest, NextResponse } from "next/server";

function getSafeNextPath(value:string|null) {return internalAuthRedirect(value,'/');}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const siteOrigin = configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") {
    const loginUrl = new URL("/login", siteOrigin);
    loginUrl.searchParams.set("error", "This legacy authentication callback is disabled.");
    return NextResponse.redirect(loginUrl);
  }
  const code = requestUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(
    requestUrl.searchParams.get("next"),
  );

  if (!code) {
    const errorDescription =
      requestUrl.searchParams.get("error_description") ||
      requestUrl.searchParams.get("error") ||
      "Authentication link could not be confirmed.";

    const loginUrl = new URL("/login", siteOrigin);
    loginUrl.searchParams.set("error", errorDescription);

    return NextResponse.redirect(loginUrl);
  }

  const supabase = await (await import("@/lib/supabase/server")).createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const loginUrl = new URL("/login", siteOrigin);
    loginUrl.searchParams.set(
      "error",
      error.message || "Authentication link could not be confirmed.",
    );

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(
    new URL(nextPath, siteOrigin),
  );
}
