import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  getRoutePermissionRequirement,
  meetsPermissionRequirement,
  type TracePointPermission,
} from "@/lib/tracepoint/permissions";

import type { Database } from "./database.types";

const PUBLIC_PATHS = ["/login", "/auth/callback"];
const AUTH_FLOW_PATHS = [
  "/auth/setup",
  "/auth/signout",
  "/unauthorized",
];

type MembershipRow = {
  department_id?: string | null;
};

type MembershipRoleRow = {
  role_code?: string | null;
};

type RolePermissionRow = {
  permission_code?: string | null;
};

function pathMatches(pathname: string, path: string) {
  const normalizedPath = pathname.toLowerCase();
  const normalizedTarget = path.toLowerCase();

  return (
    normalizedPath === normalizedTarget ||
    normalizedPath.startsWith(`${normalizedTarget}/`)
  );
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) =>
    pathMatches(pathname, path),
  );
}

function isAuthFlowPath(pathname: string) {
  return AUTH_FLOW_PATHS.some((path) =>
    pathMatches(pathname, path),
  );
}

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });

  return target;
}

function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  parameters?: Record<string, string>,
) {
  const destination = request.nextUrl.clone();
  destination.pathname = pathname;
  destination.search = "";

  for (const [key, value] of Object.entries(parameters ?? {})) {
    destination.searchParams.set(key, value);
  }

  return copyCookies(response, NextResponse.redirect(destination));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const pathname = request.nextUrl.pathname;
  const authenticated = Boolean(claims?.sub);

  if (!authenticated && !isPublicPath(pathname)) {
    const requestedPath = `${pathname}${request.nextUrl.search}`;

    return redirectWithCookies(
      request,
      response,
      "/login",
      { next: requestedPath },
    );
  }

  if (!authenticated) {
    return response;
  }

  if (pathname.toLowerCase() === "/login") {
    const requestedNext =
      request.nextUrl.searchParams.get("next") || "/";

    return redirectWithCookies(
      request,
      response,
      "/auth/setup",
      { next: requestedNext },
    );
  }

  if (isPublicPath(pathname) || isAuthFlowPath(pathname)) {
    return response;
  }

  const userId = String(claims?.sub ?? "");

  const { data: membershipData, error: membershipError } =
    await supabase
      .from("department_memberships")
      .select("department_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

  const membership = membershipData as MembershipRow | null;
  const departmentId = membership?.department_id ?? "";

  if (membershipError || !departmentId) {
    return redirectWithCookies(
      request,
      response,
      "/auth/setup",
      { next: `${pathname}${request.nextUrl.search}` },
    );
  }

  const requirement =
    getRoutePermissionRequirement(pathname);

  if (!requirement) {
    return response;
  }

  const { data: roleData, error: roleError } = await supabase
    .from("department_membership_roles")
    .select("role_code")
    .eq("department_id", departmentId)
    .eq("user_id", userId);

  if (roleError) {
    return redirectWithCookies(
      request,
      response,
      "/unauthorized",
      { from: pathname },
    );
  }

  const roleCodes = ((roleData ?? []) as MembershipRoleRow[])
    .map((row) => row.role_code)
    .filter((value): value is string => Boolean(value));

  if (roleCodes.length === 0) {
    return redirectWithCookies(
      request,
      response,
      "/unauthorized",
      { from: pathname },
    );
  }

  const { data: permissionData, error: permissionError } =
    await supabase
      .from("department_role_permissions")
      .select("permission_code")
      .eq("department_id", departmentId)
      .in("role_code", roleCodes);

  if (permissionError) {
    return redirectWithCookies(
      request,
      response,
      "/unauthorized",
      { from: pathname },
    );
  }

  const permissions = Array.from(
    new Set(
      ((permissionData ?? []) as RolePermissionRow[])
        .map((row) => row.permission_code)
        .filter(
          (value): value is TracePointPermission =>
            Boolean(value),
        ),
    ),
  );

  if (!meetsPermissionRequirement(permissions, requirement)) {
    return redirectWithCookies(
      request,
      response,
      "/unauthorized",
      { from: pathname },
    );
  }

  return response;
}
