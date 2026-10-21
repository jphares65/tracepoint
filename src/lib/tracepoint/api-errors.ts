import { NextResponse } from "next/server";

// API responses never carry database or identity-provider error text. The
// detail is logged server-side and the caller receives a fixed message with
// the same status and response shape as before.
export function unexpectedErrorResponse(scope: string, error: unknown, message: string, status = 500) {
  console.error(`${scope} failed`, error);
  return NextResponse.json({ error: message }, { status });
}
