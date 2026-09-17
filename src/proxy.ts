import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const isLocalMobilePreview =
    /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origin);
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");

  if (request.method === "OPTIONS" && isApiRequest && isLocalMobilePreview) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const response = await updateSession(request);
  if (isApiRequest && isLocalMobilePreview) {
    for (const [name, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(name, value);
    }
  }
  return response;
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

export const config = {
  matcher: [
    "/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

