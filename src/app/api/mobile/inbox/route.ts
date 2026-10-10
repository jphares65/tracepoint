import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

type NotificationEventRow = {
  id: string;
  notification_key: string | null;
  title: string | null;
  detail: string | null;
  href: string | null;
  priority: string | null;
  source: string | null;
  kind: string | null;
  source_created_at: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  last_seen_at: string | null;
};

type MobileInboxItem = {
  id: string;
  notificationKey: string;
  title: string;
  detail: string;
  href: string;
  priority: "Critical" | "High" | "Normal";
  source: string;
  kind: string;
  createdAt: string | null;
  lastSeenAt: string | null;
};

const priorityRank: Record<MobileInboxItem["priority"], number> = {
  Critical: 0,
  High: 1,
  Normal: 2,
};

function normalizePriority(
  value: string | null,
): MobileInboxItem["priority"] {
  return value === "Critical" || value === "High"
    ? value
    : "Normal";
}

function itemTimestamp(item: MobileInboxItem) {
  const raw = item.lastSeenAt || item.createdAt || "";
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

export async function GET(request: Request) {
  const resolved = await resolveServerAccess(request);

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const { admin, departmentId, userId } = resolved.context;

  const { data, error } = await admin
    .from("notification_events")
    .select(
      [
        "id",
        "notification_key",
        "title",
        "detail",
        "href",
        "priority",
        "source",
        "kind",
        "source_created_at",
        "acknowledged_at",
        "snoozed_until",
        "last_seen_at",
      ].join(","),
    )
    .eq("department_id", departmentId)
    .eq("user_id", userId)
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "The mobile Inbox could not be loaded." },
      { status: 500 },
    );
  }

  const now = Date.now();

  const items = ((data ?? []) as NotificationEventRow[])
    .filter((row) => {
      if (row.acknowledged_at) return false;

      if (!row.snoozed_until) {
        return true;
      }

      const snoozedUntil = Date.parse(row.snoozed_until);

      return !Number.isFinite(snoozedUntil) || snoozedUntil <= now;
    })
    .map(
      (row): MobileInboxItem => ({
        id: String(row.id),
        notificationKey: String(row.notification_key ?? ""),
        title: String(row.title ?? "TracePoint action"),
        detail: String(row.detail ?? ""),
        href: String(row.href ?? ""),
        priority: normalizePriority(row.priority),
        source: String(row.source ?? "TracePoint"),
        kind: String(row.kind ?? ""),
        createdAt: row.source_created_at ?? null,
        lastSeenAt: row.last_seen_at ?? null,
      }),
    )
    .sort(
      (left, right) =>
        priorityRank[left.priority] - priorityRank[right.priority] ||
        itemTimestamp(right) - itemTimestamp(left),
    );

  const approvals = items.filter((item) =>
    /(review|approval|certif|decision)/i.test(
      `${item.kind} ${item.title}`,
    ),
  ).length;

  const dueExpiring = items.filter((item) =>
    /(expir|due|reorder|required|missing)/i.test(
      `${item.kind} ${item.title}`,
    ),
  ).length;

  return NextResponse.json(
    {
      items,
      counts: {
        open: items.length,
        criticalHigh: items.filter(
          (item) =>
            item.priority === "Critical" ||
            item.priority === "High",
        ).length,
        approvals,
        dueExpiring,
      },
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}