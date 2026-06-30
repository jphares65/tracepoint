import { NextRequest, NextResponse } from "next/server";

function getRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (origin) {
    return origin.replace(/\/$/, "");
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  }

  return request.nextUrl.origin.replace(/\/$/, "");
}

export async function GET(request: NextRequest) {
  const requestOrigin = getRequestOrigin(request);
  const configuredSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? null;

  const setupPath = "/auth/setup";
  const callbackPath = `/auth/callback?next=${encodeURIComponent(setupPath)}`;

  return NextResponse.json({
    ok: true,
    requestOrigin,
    configuredSiteUrl,
    nextUrlOrigin: request.nextUrl.origin,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    expectedAuthCallbackUrl: `${requestOrigin}${callbackPath}`,
    expectedConfiguredCallbackUrl: configuredSiteUrl
      ? `${configuredSiteUrl}${callbackPath}`
      : null,
    expectedSetupPath: setupPath,
    note: "Invite and password reset emails should redirect through /auth/callback?next=/auth/setup.",
  });
}