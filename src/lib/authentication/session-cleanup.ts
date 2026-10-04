import { type NextResponse } from "next/server";

import {
  COGNITO_FLOW_COOKIE,
  COGNITO_SESSION_COOKIE,
} from "./cognito-transport";

export const LOCAL_SESSION_COOKIE_NAMES = [
  COGNITO_SESSION_COOKIE,
  COGNITO_FLOW_COOKIE,
  "tracepoint_department_id",
  "tracepoint_support_department_id",
] as const;

/**
 * Removes local authentication state from the request that continues to the
 * application. A response Set-Cookie does not alter the current request, so a
 * server component would otherwise see (and attempt to parse) the same bad
 * cookie while rendering the login page.
 */
export function withoutLocalSessionCookies(cookieHeader: string | null) {
  return (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const separator = part.indexOf("=");
      return separator < 0 || !LOCAL_SESSION_COOKIE_NAMES.includes(part.slice(0, separator) as typeof LOCAL_SESSION_COOKIE_NAMES[number]);
    })
    .join("; ");
}

export function clearLocalSessionState(response: NextResponse) {
  for (const name of LOCAL_SESSION_COOKIE_NAMES) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}
