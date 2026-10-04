import { type NextResponse } from "next/server";

import {
  COGNITO_FLOW_COOKIE,
  COGNITO_SESSION_COOKIE,
} from "./cognito-transport";

const LOCAL_SESSION_COOKIE_NAMES = [
  COGNITO_SESSION_COOKIE,
  COGNITO_FLOW_COOKIE,
  "tracepoint_department_id",
  "tracepoint_support_department_id",
] as const;

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
