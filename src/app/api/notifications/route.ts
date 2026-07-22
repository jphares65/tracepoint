import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Priority = "Critical" | "High" | "Normal";
type Source = "Personal Rifle" | "Ammunition" | "Inspection" | "Range";

type GeneratedAlert = {
  key: string;
  source: Source;
  kind: string;
  title: string;
  detail: string;
  href: string;
  priority: Priority;
  createdAt?: string | null;
};

type ExistingNotificationEvent = {
  notification_key?: string | null;
  fingerprint?: string | null;
  first_seen_at?: string | null;
  acknowledged_at?: string | null;
  snoozed_until?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function get(record: any, ...keys: string[]) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null) return record[key];
  }
  return undefined;
}

function list(record: any, ...keys: string[]) {
  const candidate = get(record, ...keys);
  return Array.isArray(candidate) ? candidate : [];
}

function dateValue(value?: string | null) {
  if (!value) return 0;
  const parsed = value.includes("T")
    ? new Date(value).getTime()
    : new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getContext() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in.", status: 401 } as const;

  const admin = createAdminClient() as any;
  const { data: membership, error } = await admin
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 } as const;
  if (!membership?.department_id) {
    return { error: "No active department membership was found.", status: 403 } as const;
  }

  const departmentId = String(membership.department_id);
  const { data: roles } = await admin
    .from("department_membership_roles")
    .select("role_code")
    .eq("department_id", departmentId)
    .eq("user_id", user.id);

  const roleCodes = (roles ?? []).map((row: any) => String(row.role_code));
  const canManageArmory = roleCodes.some((role: string) =>
    ["chief", "administrator", "department_admin", "admin", "armorer", "range_master"].includes(role),
  );
  const canManageRange = roleCodes.some((role: string) =>
    ["chief", "administrator", "department_admin", "admin", "range_master", "instructor", "supervisor", "command_staff"].includes(role),
  );

  return { admin, user, departmentId, canManageArmory, canManageRange } as const;
}

async function internalJson(request: Request, path: string) {
  try {
    const response = await fetch(new URL(path, request.url), {
      cache: "no-store",
      headers: request.headers.get("cookie")
        ? { cookie: request.headers.get("cookie") as string }
        : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, payload, error: text(payload?.error) };
  } catch (error) {
    return { ok: false, payload: null, error: error instanceof Error ? error.message : "Source failed." };
  }
}

function collectPersonalRifles(payload: any): GeneratedAlert[] {
  return list(payload, "items").map((item: any) => ({
    key: text(item.id) || `personal-rifle-${text(item.rifleId)}`,
    source: "Personal Rifle",
    kind: text(item.kind) || "personal_rifle",
    title: text(item.title) || "Personal Rifle Action Required",
    detail: text(item.detail) || "Open the personal rifle record.",
    href: text(item.href) || "/firearms/personal-rifles",
    priority: item.priority === "Critical" ? "Critical" : item.priority === "Normal" ? "Normal" : "High",
    createdAt: text(item.createdAt) || null,
  }));
}

function collectAmmunition(payload: any): GeneratedAlert[] {
  const workspace = payload?.workspace ?? payload ?? {};
  const types = [workspace.ammoTypes, workspace.ammunitionTypes, workspace.types].find(Array.isArray) ?? [];
  const alerts: GeneratedAlert[] = [];

  for (const item of types) {
    if (item?.isActive === false) continue;
    const id = text(get(item, "id", "ammoTypeId")) || text(item.name);
    const name = text(get(item, "name", "label", "caliber")) || "Ammunition";
    const onHand = Math.max(0, Math.trunc(numeric(get(item, "currentOnHand", "current_on_hand", "onHand", "quantityOnHand"))));
    const threshold = Math.max(0, Math.trunc(numeric(get(item, "reorderThreshold", "reorder_threshold", "lowStockThreshold"))));

    if (threshold > 0 && onHand <= threshold) {
      alerts.push({
        key: `ammunition-reorder-${id}`,
        source: "Ammunition",
        kind: "ammunition_reorder",
        title: `${name} Reorder Required`,
        detail: `${onHand.toLocaleString()} ${text(get(item, "unitLabel", "unit_label")) || "rounds"} remain. Reorder point: ${threshold.toLocaleString()}.`,
        href: "/firearms/ammunition",
        priority: onHand === 0 ? "Critical" : "High",
        createdAt: text(get(item, "updatedAt", "updated_at")) || null,
      });
    }

    const nextCount = text(get(item, "nextVerificationDate", "next_verification_date"));
    if (nextCount && dateValue(nextCount) <= Date.now()) {
      alerts.push({
        key: `ammunition-count-${id}`,
        source: "Ammunition",
        kind: "ammunition_physical_count_due",
        title: `${name} Physical Count Due`,
        detail: `The configured physical-count date was ${nextCount}.`,
        href: "/firearms/ammunition",
        priority: "High",
        createdAt: nextCount,
      });
    }
  }

  return alerts;
}

function collectInspections(payload: any, context: any): GeneratedAlert[] {
  const alerts: GeneratedAlert[] = [];

  for (const firearm of list(payload, "firearms")) {
    const status = text(get(firearm, "condition_status", "conditionStatus"));
    if (!["Inspection Required", "Maintenance", "Out of Service"].includes(status)) continue;

    const assignment = firearm.active_assignment ?? firearm.activeAssignment ?? null;
    const assignedUserId = text(get(assignment, "assigned_to_user_id", "assignedToUserId"));
    if (!context.canManageArmory && assignedUserId !== context.user.id) continue;

    const id = text(firearm.id);
    const name = [text(firearm.make), text(firearm.model)].filter(Boolean).join(" ") || "Firearm";
    const serial = text(firearm.serial_number) || "serial not recorded";

    alerts.push({
      key: `firearm-condition-${id}`,
      source: "Inspection",
      kind: status === "Out of Service" ? "firearm_out_of_service" : status === "Maintenance" ? "firearm_maintenance" : "firearm_inspection_required",
      title: status === "Out of Service" ? "Firearm Out of Service" : status === "Maintenance" ? "Firearm Maintenance Required" : "Firearm Inspection Required",
      detail: `${name} Â· SN ${serial} Â· ${status}`,
      href: id ? `/firearms/${id}` : "/firearms/inspections",
      priority: status === "Out of Service" ? "Critical" : "High",
      createdAt: text(firearm.updated_at) || null,
    });
  }

  return alerts;
}

function collectRange(payload: any, context: any): GeneratedAlert[] {
  const workspace = payload?.workspace ?? payload ?? {};
  const rangeDays = list(workspace, "rangeDays", "range_days");
  const roster = list(workspace, "rangeRoster", "range_roster");
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const alerts: GeneratedAlert[] = [];

  for (const day of rangeDays) {
    const id = text(day.id);
    const status = text(day.status);
    const date = text(day.date);
    const scheduled = dateValue(date);
    if (!id || !scheduled || ["Archived", "Completed", "Cancelled"].includes(status)) continue;

    const title = text(day.title) || "Range Day";
    const location = text(day.location) || "Location not set";
    const lead = text(get(day, "leadInstructorId", "lead_instructor_id"));
    const instructors = list(day, "instructorIds", "instructor_ids").map(String);
    const rostered = roster.some((entry: any) =>
      text(get(entry, "rangeDayId", "range_day_id")) === id &&
      text(get(entry, "officerId", "officer_id")) === context.user.id,
    );
    const isInstructor = lead === context.user.id || instructors.includes(context.user.id);

    if ((rostered || isInstructor) && scheduled >= todayStart && scheduled <= todayStart + 14 * 86400000) {
      alerts.push({
        key: `range-assignment-${id}`,
        source: "Range",
        kind: isInstructor ? "range_instructor_assignment" : "range_officer_assignment",
        title: isInstructor ? "Instructor Range Assignment" : "Upcoming Range Assignment",
        detail: `${title} Â· ${date} Â· ${location}`,
        href: "/range-days",
        priority: "Normal",
        createdAt: date,
      });
    }

    const packet = text(get(day, "packetStatus", "packet_status"));
    if (context.canManageRange && scheduled >= todayStart && scheduled <= todayStart + 7 * 86400000 && packet && packet !== "Ready") {
      alerts.push({
        key: `range-packet-${id}`,
        source: "Range",
        kind: "range_packet_not_ready",
        title: "Range Packet Not Ready",
        detail: `${title} is scheduled for ${date}. Packet status: ${packet}.`,
        href: "/range-days",
        priority: "High",
        createdAt: date,
      });
    }
  }

  return alerts;
}

async function getPreferences(context: any) {
  const { data, error } = await context.admin
    .from("notification_preferences")
    .select("in_app_enabled,email_enabled,critical_email_only,digest_mode,source_preferences")
    .eq("department_id", context.departmentId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    in_app_enabled: data?.in_app_enabled ?? true,
    email_enabled: data?.email_enabled ?? false,
    critical_email_only: data?.critical_email_only ?? true,
    digest_mode: data?.digest_mode === "Daily" || data?.digest_mode === "Weekly" ? data.digest_mode : "Immediate",
    source_preferences: {
      "Personal Rifle": true,
      Ammunition: true,
      Inspection: true,
      Range: true,
      ...(data?.source_preferences ?? {}),
    },
  };
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
    const preferences = await getPreferences(context);
    const [rifles, ammunition, firearms, range] = await Promise.all([
      internalJson(request, "/api/armory/personal-rifles/inbox"),
      internalJson(request, "/api/pilot/ammunition"),
      internalJson(request, "/api/armory/firearms"),
      internalJson(request, "/api/pilot/range-workspace"),
    ]);

    const generated: GeneratedAlert[] = [];
    const successful = new Set<string>();
    const sourceErrors: Array<{ source: string; error: string }> = [];

    if (rifles.ok) { successful.add("Personal Rifle"); generated.push(...collectPersonalRifles(rifles.payload)); }
    else sourceErrors.push({ source: "Personal Rifle", error: rifles.error || "Unavailable" });

    if (ammunition.ok) { successful.add("Ammunition"); generated.push(...collectAmmunition(ammunition.payload)); }
    else sourceErrors.push({ source: "Ammunition", error: ammunition.error || "Unavailable" });

    if (firearms.ok) { successful.add("Inspection"); generated.push(...collectInspections(firearms.payload, context)); }
    else sourceErrors.push({ source: "Inspection", error: firearms.error || "Unavailable" });

    if (range.ok) { successful.add("Range"); generated.push(...collectRange(range.payload, context)); }
    else sourceErrors.push({ source: "Range", error: range.error || "Unavailable" });

    const filtered = preferences.in_app_enabled
      ? generated.filter((item) => preferences.source_preferences[item.source] !== false)
      : [];

    const now = new Date().toISOString();
    const { data: existing, error: existingError } = await context.admin
      .from("notification_events")
      .select("*")
      .eq("department_id", context.departmentId)
      .eq("user_id", context.user.id);

    if (existingError) throw new Error(existingError.message);
    const byKey = new Map<string, ExistingNotificationEvent>(
      (existing ?? []).map(
        (row: ExistingNotificationEvent): [string, ExistingNotificationEvent] => [
          String(row.notification_key),
          row,
        ],
      ),
    );

    for (const item of filtered) {
      const prior = byKey.get(item.key);
      const fingerprint = JSON.stringify(item);
      const changed = prior && String(prior.fingerprint) !== fingerprint;

      const { error } = await context.admin.from("notification_events").upsert({
        department_id: context.departmentId,
        user_id: context.user.id,
        notification_key: item.key,
        source: item.source,
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        href: item.href,
        priority: item.priority,
        fingerprint,
        source_created_at: item.createdAt || null,
        first_seen_at: prior?.first_seen_at ?? now,
        last_seen_at: now,
        resolved_at: null,
        acknowledged_at: changed ? null : prior?.acknowledged_at ?? null,
        snoozed_until: changed ? null : prior?.snoozed_until ?? null,
        updated_at: now,
      }, { onConflict: "department_id,user_id,notification_key" });

      if (error) throw new Error(error.message);

      if (preferences.email_enabled && (!preferences.critical_email_only || item.priority === "Critical") && context.user.email) {
        await context.admin.from("notification_email_queue").upsert({
          department_id: context.departmentId,
          user_id: context.user.id,
          recipient_email: context.user.email,
          notification_key: item.key,
          fingerprint,
          subject: `[TracePoint] ${item.title}`,
          body_text: `${item.title}\n\n${item.detail}\n\nOpen TracePoint: ${item.href}`,
          scheduled_for: now,
          status: "Pending",
          updated_at: now,
        }, { onConflict: "department_id,user_id,notification_key,fingerprint", ignoreDuplicates: true });
      }
    }

    const activeKeys = new Set(filtered.map((item) => item.key));
    for (const row of existing ?? []) {
      if (successful.has(String(row.source)) && !activeKeys.has(String(row.notification_key)) && !row.resolved_at) {
        await context.admin.from("notification_events").update({ resolved_at: now, updated_at: now }).eq("id", row.id);
      }
    }

    const { data: rows, error: rowsError } = await context.admin
      .from("notification_events")
      .select("*")
      .eq("department_id", context.departmentId)
      .eq("user_id", context.user.id)
      .is("resolved_at", null)
      .order("last_seen_at", { ascending: false });

    if (rowsError) throw new Error(rowsError.message);

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
    }));

    const visible = allOpenItems.filter((item: any) => {
      if (item.acknowledgedAt) return false;
      if (!item.snoozedUntil) return true;
      return new Date(item.snoozedUntil).getTime() <= Date.now();
    });

    const items = sortRows(visible);

    return NextResponse.json({
      items,
      allOpenItems: sortRows(allOpenItems),
      preferences,
      sourceErrors,
      counts: {
        open: items.length,
        critical: items.filter((item: any) => item.priority === "Critical").length,
        high: items.filter((item: any) => item.priority === "High").length,
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

