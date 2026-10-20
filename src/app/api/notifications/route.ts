import { NextRequest, NextResponse } from "next/server";

import { resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createNotificationReadRepository } from "@/lib/notifications/read-repository";
import { internalSourceUrl } from "@/lib/notifications/internal-source-url";
import { notificationDateValue } from "@/lib/notifications/date-value";
import { CONDITION_BASED_NOTIFICATION_KINDS } from "@/lib/notifications/acknowledge-policy";
import { notificationContext, reconcileUserNotifications } from "@/lib/notifications/user-notification-generator";

type Priority = "Critical" | "High" | "Normal";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const dateValue = notificationDateValue;

async function getContext() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return {
      error: access.error,
      status: access.status,
    } as const;
  }

  return notificationContext(access.context);
}

async function internalJson(request: Request, path: string) {
  try {
    const response = await fetch(internalSourceUrl(
      path, request.url, process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE, process.env.PORT,
    ), {
      cache: "no-store",
      headers: request.headers.get("cookie")
        ? { cookie: request.headers.get("cookie") as string }
        : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, payload, error: text(payload?.error), status: response.status };
  } catch (error) {
    if (process.env.TRACEPOINT_NOTIFICATION_MODE === "shadow") {
      const cause = error instanceof Error && "cause" in error ? error.cause : null;
      const causeCode = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
        ? cause.code : "none";
      const origin = new URL(request.url);
      console.warn(JSON.stringify({
        event: "shadow_home_internal_fetch_failure",
        source: path,
        requestHost: origin.hostname,
        requestProtocol: origin.protocol,
        errorName: error instanceof Error ? error.name : "unknown",
        causeCode,
      }));
    }
    return { ok: false, payload: null, error: error instanceof Error ? error.message : "Source failed.", status: 0 };
  }
}

function canReviewDepartmentInbox(context: any) {
  const permissions = Array.isArray(context?.permissions)
    ? context.permissions
    : [];

  return (
    context?.isSupportMode === true ||
    permissions.includes("review_off_duty_requests")
  );
}

function getNotificationInboxScope(
  row: any,
  context: any,
): "my" | "department" {
  const key = text(row?.notification_key);
  const kind = text(row?.kind);
  const source = text(row?.source);
  const userId = text(context?.userId) || text(context?.user?.id);

  if (userId && key.includes(userId)) {
    return "my";
  }

  if (source === "Personal Rifle") {
    return "my";
  }

  if (
    kind === "off_duty_firearm_review_required" &&
    canReviewDepartmentInbox(context)
  ) {
    return "department";
  }

  if (
    (source === "Ammunition" || source === "Inspection") &&
    context?.canManageArmory
  ) {
    return "department";
  }

  if (
    source === "Range" &&
    ["range_officer_assignment", "range_instructor_assignment"].includes(kind)
  ) {
    return "my";
  }

  if (source === "Range" && context?.canManageRange) {
    return "department";
  }

  if (
    ["Qualifications", "Training", "Equipment"].includes(source) &&
    context?.canViewDepartmentReadiness
  ) {
    return "department";
  }

  return "my";
}
function sortRows(rows: any[]) {
  const weight = { Critical: 0, High: 1, Normal: 2 };
  return [...rows].sort((a, b) => {
    const priority = weight[a.priority as Priority] - weight[b.priority as Priority];
    if (priority !== 0) return priority;
    return dateValue(b.createdAt || b.lastSeenAt) - dateValue(a.createdAt || a.lastSeenAt);
  });
}

export async function GET(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  try {
    const { preferences, sourceErrors } = await reconcileUserNotifications(context, (path) => internalJson(request, path));

    const rows = await createNotificationReadRepository(context.admin, context.departmentId, context.user.id).listNotificationEvents(context.departmentId, context.user.id, true);

    const allOpenItems = (rows ?? []).map((row: any) => ({
      id: row.id,
      notificationKey: row.notification_key,
      title: row.title,
      detail: row.detail,
      href: row.href,
      priority: row.priority,
      source: row.source,
      kind: row.kind,
      createdAt: row.source_created_at,
      acknowledgedAt: row.acknowledged_at,
      snoozedUntil: row.snoozed_until,
      lastSeenAt: row.last_seen_at,
      inboxScope: getNotificationInboxScope(row, context),
    }));

    const visible = allOpenItems.filter((item: any) => {
      if (item.acknowledgedAt) return false;
      if (!item.snoozedUntil) return true;
      return new Date(item.snoozedUntil).getTime() <= Date.now();
    });
    const items = sortRows(visible);

    const myItems = sortRows(
      items.filter((item: any) => item.inboxScope === "my"),
    );

    const departmentItems = sortRows(
      items.filter((item: any) => item.inboxScope === "department"),
    );

    const canViewDepartmentInbox =
      context.isSupportMode === true ||
      context.canManageArmory ||
      context.canManageRange ||
      context.canViewDepartmentReadiness ||
      canReviewDepartmentInbox(context);
    return NextResponse.json({
      items: myItems,
      departmentItems,
      canViewDepartmentInbox,
      isSupportMode: context.isSupportMode,
      allOpenItems: sortRows(allOpenItems),
      preferences,
      sourceErrors,
      counts: {
        open: myItems.length,
        myOpen: myItems.length,
        departmentOpen: departmentItems.length,
        critical: myItems.filter((item: any) => item.priority === "Critical").length,
        high: myItems.filter((item: any) => item.priority === "High").length,
        normal: items.filter((item: any) => item.priority === "Normal").length,
        acknowledged: allOpenItems.filter((item: any) => item.acknowledgedAt).length,
        snoozed: allOpenItems.filter((item: any) => item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now()).length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Notifications could not be generated." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });

  const body = await request.json().catch(() => ({})) as any;
  const action = text(body.action);
  const id = text(body.notificationId);
  if (!id || !["acknowledge", "reopen", "snooze", "unsnooze"].includes(action)) {
    return NextResponse.json({ error: "A valid action and notification ID are required." }, { status: 400 });
  }

  const { data: notification, error: notificationError } = await context.admin
    .from("notification_events")
    .select("id,kind")
    .eq("id", id)
    .eq("department_id", context.departmentId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (notificationError) {
    return NextResponse.json(
      { error: notificationError.message },
      { status: 500 },
    );
  }

  if (!notification) {
    return NextResponse.json(
      { error: "Notification was not found." },
      { status: 404 },
    );
  }

  if (
    action === "acknowledge" &&
    CONDITION_BASED_NOTIFICATION_KINDS.has(String(notification.kind))
  ) {
    return NextResponse.json(
      {
        error:
          "This readiness alert remains open until the underlying condition is resolved. You may snooze it temporarily.",
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const patch = action === "acknowledge"
    ? { acknowledged_at: now, updated_at: now }
    : action === "reopen"
      ? { acknowledged_at: null, snoozed_until: null, updated_at: now }
      : action === "snooze"
        ? { snoozed_until: body.snoozedUntil || new Date(Date.now() + 86400000).toISOString(), updated_at: now }
        : { snoozed_until: null, updated_at: now };

  const { error } = await context.admin
    .from("notification_events")
    .update(patch)
    .eq("id", id)
    .eq("department_id", context.departmentId)
    .eq("user_id", context.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}








