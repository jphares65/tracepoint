import { NextResponse } from "next/server";
import { revokeRuntimeCognitoMobileBearer } from "@/lib/authentication/cognito-mobile-session";
import { parseUniqueBearerToken } from "@/lib/authentication/request-bearer-core";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = parseUniqueBearerToken(request.headers.get("authorization"));
  if (!token || !await revokeRuntimeCognitoMobileBearer(token)) {
    return NextResponse.json({ error: "Mobile authentication is required." }, { status: 401, headers: { "Cache-Control": "no-store, private" } });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, private" } });
}
