import {internalAuthRedirect,configuredSiteOrigin} from '@/lib/authentication/redirects';
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";

function getSafeNextPath(value:string|null) {return internalAuthRedirect(value,'/auth/setup');}

function isSupportedType(value: string | null): value is EmailOtpType {
  return value === "invite" || value === "recovery";
}

function redirectToLogin(siteOrigin: string, message: string) {
  const loginUrl = new URL("/login", siteOrigin);
  loginUrl.searchParams.set("error", message);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const siteOrigin = configuredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (!tokenHash || !isSupportedType(type)) {
    return redirectToLogin(
      siteOrigin,
      "Authentication link is incomplete or invalid.",
    );
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return redirectToLogin(
      siteOrigin,
      error.message || "Authentication link could not be confirmed.",
    );
  }

  return NextResponse.redirect(new URL(nextPath, siteOrigin));
}