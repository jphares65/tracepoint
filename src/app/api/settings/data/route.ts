import { NextRequest, NextResponse } from "next/server";

import { setCognitoMembershipActive } from "@/lib/authentication/cognito-membership-lifecycle";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { notificationMode } from "@/lib/email/notification-mode";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

const TABLES = new Set([
  "departments", "department_rules", "department_security_settings", "department_group_members",
  "department_qualification_standards", "department_qualification_standard_components",
  "department_titles", "department_units", "department_groups",
]);
const RPCS = new Set(["update_department_member", "set_department_member_roles", "set_department_group_members"]);
const identifier = /^[a-z][a-z0-9_]*$/;
const fieldsPattern = /^[a-z0-9_, ]+$/i;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeError(value: unknown) {
  const error = object(value);
  return {
    message: "The settings operation could not be completed.",
    code: typeof error?.code === "string" ? error.code : undefined,
  };
}

export async function POST(request: NextRequest) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const body = object(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Invalid settings request." }, { status: 400 });

  if (typeof body.rpc === "string") {
    if (!RPCS.has(body.rpc) || !object(body.args)) return NextResponse.json({ error: "Unsupported settings command." }, { status: 400 });
    const departmentId = String((body.args as Record<string, unknown>).p_department_id ?? "");
    if (departmentId !== access.context.departmentId) return NextResponse.json({ error: "The active agency does not match this command." }, { status: 403 });
    const args = body.args as Record<string, unknown>;
    if (body.rpc === "update_department_member" && typeof args.p_is_active === "boolean" &&
        process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native" && notificationMode(process.env) === "normal") {
      // Activation changes use the Cognito membership lifecycle the import path
      // uses (disable + global sign-out + session revocation, or re-enable).
      // Shadow environments keep the database-only change: identity mutation is disabled there.
      const userId = String(args.p_user_id ?? "");
      const membership = await access.context.db.from("department_memberships").select("is_active")
        .eq("department_id", departmentId).eq("user_id", userId).maybeSingle();
      if (membership.error) return NextResponse.json(safeError(membership.error), { status: 400 });
      const current = membership.data as { is_active?: unknown } | null;
      const linked = current && current.is_active !== args.p_is_active && (await getPostgresPool().query(
        "select 1 from public.authentication_identity_links where provider='cognito' and tracepoint_user_id=$1 and state in ('pending','active')",
        [userId],
      )).rowCount === 1;
      if (linked) {
        try {
          await setCognitoMembershipActive(
            { actorUserId: access.context.userId, departmentId, targetUserId: userId, active: args.p_is_active, supportMode: access.context.isSupportMode },
            async client => { await client.query(
              "select public.update_department_member(p_department_id=>$1,p_user_id=>$2,p_badge_number=>$3,p_rank_title=>$4,p_unit_name=>$5,p_employee_number=>$6,p_is_active=>$7)",
              [departmentId, userId, args.p_badge_number ?? null, args.p_rank_title ?? null, args.p_unit_name ?? null, args.p_employee_number ?? null, args.p_is_active],
            ); },
          );
        } catch (error) {
          return NextResponse.json(safeError(error), { status: 400 });
        }
        return NextResponse.json({ data: null });
      }
    }
    const result = await access.context.db.rpc(body.rpc, body.args);
    if (result.error) return NextResponse.json(safeError(result.error), { status: 400 });
    return NextResponse.json({ data: result.data ?? null });
  }

  const table = typeof body.table === "string" ? body.table : "";
  const operation = typeof body.operation === "string" ? body.operation : "";
  if (!TABLES.has(table) || !["select", "insert", "update", "upsert", "delete"].includes(operation)) {
    return NextResponse.json({ error: "Unsupported settings operation." }, { status: 400 });
  }
  const filters = Array.isArray(body.filters) ? body.filters.map(object) : [];
  if (filters.some(filter => !filter || !["eq", "in"].includes(String(filter.kind)) || !identifier.test(String(filter.column)))) {
    return NextResponse.json({ error: "Invalid settings filters." }, { status: 400 });
  }
  const payload = object(body.payload);
  const tenantFilter = filters.find(filter => filter?.column === (table === "departments" ? "id" : "department_id"));
  const payloadTenant = payload?.[table === "departments" ? "id" : "department_id"];
  if (operation !== "select" && String(tenantFilter?.value ?? payloadTenant ?? "") !== access.context.departmentId) {
    return NextResponse.json({ error: "The active agency does not match this mutation." }, { status: 403 });
  }
  if (operation === "select" && String(tenantFilter?.value ?? "") !== access.context.departmentId) {
    return NextResponse.json({ error: "The active agency does not match this query." }, { status: 403 });
  }

  let query = access.context.db.from(table);
  if (operation === "select") {
    const fields = typeof body.fields === "string" && fieldsPattern.test(body.fields) ? body.fields : "*";
    query = query.select(fields);
  } else if (operation === "insert") query = query.insert(payload);
  else if (operation === "update") query = query.update(payload);
  else if (operation === "upsert") {
    const options = object(body.options);
    query = query.upsert(payload, { onConflict: typeof options?.onConflict === "string" ? options.onConflict : undefined });
  } else query = query.delete();
  for (const filter of filters) {
    if (filter?.kind === "eq") query = query.eq(String(filter.column), filter.value);
    else query = query.in(String(filter?.column), Array.isArray(filter?.value) ? filter.value : []);
  }
  if (Array.isArray(body.orders)) {
    for (const value of body.orders) {
      const order = object(value);
      if (!order || !identifier.test(String(order.column))) return NextResponse.json({ error: "Invalid settings ordering." }, { status: 400 });
      query = query.order(String(order.column), { ascending: order.ascending !== false });
    }
  }
  if (body.mode === "single") query = query.single();
  else if (body.mode === "maybeSingle") query = query.maybeSingle();
  const result = await query;
  if (result.error) return NextResponse.json(safeError(result.error), { status: 400 });
  return NextResponse.json({ data: result.data ?? null });
}
