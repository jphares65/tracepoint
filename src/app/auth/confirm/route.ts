import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { createClient as createServerClient } from "@/lib/supabase/server";

function getSafeNextPath(value: string | null) {
  if (!value) {
    return "/auth/setup";
  }

  try {
    const decoded = decodeURIComponent(value);

    if (!decoded.startsWith("/") || decoded.startsWith("//")) {
      return "/auth/setup";
    }

    return decoded;
  } catch {
    if (!value.startsWith("/") || value.startsWith("//")) {
      return "/auth/setup";
    }

    return value;
  }
}

function isSupportedType(value: string | null): value is EmailOtpType {
  return value === "invite" || value === "recovery";
}

function redirectToLogin(requestUrl: URL, message: string) {
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", message);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (!tokenHash || !isSupportedType(type)) {
    return redirectToLogin(
      requestUrl,
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
      requestUrl,
      error.message || "Authentication link could not be confirmed.",
    );
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}