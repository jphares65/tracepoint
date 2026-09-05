import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createEmailProvider,
  EmailProviderConfigurationError,
} from "@/lib/email/provider";

import { deliverOutboxMessage } from "@/lib/email/outbox-delivery";

type QueueRow = {
  id: string;
  department_id: string;
  user_id: string;
  recipient_email: string;
  notification_key: string;
  fingerprint: string;
  attempt_count?: number | null;
};

type EventRow = {
  notification_key: string;
  fingerprint: string;
  title: string;
  detail: string;
  href: string;
  priority: string;
  source: string;
  acknowledged_at?: string | null;
  snoozed_until?: string | null;
  resolved_at?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: unknown) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absoluteUrl(siteUrl: string, href: string) {
  try {
    return new URL(href || "/", siteUrl).toString();
  } catch {
    return siteUrl;
  }
}

function buildDigestHtml(events: EventRow[], siteUrl: string) {
  const items = events.map((event) => {
    const url = absoluteUrl(siteUrl, event.href);

    return `
      <tr>
        <td style="padding:18px 0;border-bottom:1px solid #e5e9ef;">
          <div style="font-size:12px;font-weight:700;color:#667085;text-transform:uppercase;letter-spacing:.5px;">
            ${escapeHtml(event.priority)} - ${escapeHtml(event.source)}
          </div>
          <div style="margin-top:6px;font-size:17px;font-weight:700;color:#172033;">
            ${escapeHtml(event.title)}
          </div>
          <div style="margin-top:6px;font-size:14px;line-height:1.6;color:#465266;">
            ${escapeHtml(event.detail)}
          </div>
          <div style="margin-top:10px;">
            <a href="${escapeHtml(url)}" style="font-size:14px;font-weight:700;color:#2f6fed;text-decoration:none;">
              Review in TracePoint
            </a>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#172033;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding:40px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="max-width:620px;background:#ffffff;border:1px solid #dfe4ea;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="background:#172033;padding:28px 32px;text-align:center;">
                  <div style="font-size:26px;font-weight:700;color:#ffffff;">TracePoint</div>
                  <div style="margin-top:6px;font-size:13px;color:#c8d0dc;letter-spacing:1px;text-transform:uppercase;">
                    Operational Accountability
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <h1 style="margin:0 0 10px;font-size:23px;color:#172033;">
                    TracePoint Inbox Summary
                  </h1>
                  <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#465266;">
                    ${events.length} ${events.length === 1 ? "item requires" : "items require"} your attention.
                  </p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    ${items}
                  </table>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;">
                    <tr>
                      <td style="border-radius:8px;background:#2f6fed;">
                        <a href="${escapeHtml(absoluteUrl(siteUrl, "/notifications"))}"
                          style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
                          Open TracePoint Inbox
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e5e9ef;">
                  <p style="margin:0;font-size:12px;color:#98a2b3;">
                    TracePoint - Operational Accountability
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildDigestText(events: EventRow[], siteUrl: string) {
  const items = events.map((event) =>
    [
      `[${event.priority}] ${event.title}`,
      event.detail,
      absoluteUrl(siteUrl, event.href),
    ].join("\n"),
  ).join("\n\n");

  return [
    "TracePoint Inbox Summary",
    "",
    `${events.length} ${events.length === 1 ? "item requires" : "items require"} your attention.`,
    "",
    items,
    "",
    `Open TracePoint: ${absoluteUrl(siteUrl, "/notifications")}`,
  ].join("\n");
}

async function retryRows(admin: ReturnType<typeof createAdminClient>, rows: QueueRow[], message: string, forceTerminal = false, messageId: string | null = null) {
  const now = Date.now();

  await Promise.all(
    rows.map((row) => {
      const attemptCount = Number(row.attempt_count ?? 0) + 1;
      const terminal = forceTerminal || attemptCount >= 3;

      return admin
        .from("notification_email_queue")
        .update({
          status: terminal ? "Failed" : "Pending",
          attempt_count: attemptCount,
          last_error: message.slice(0, 1000),
          ...(messageId ? { provider_message_id: messageId } : {}),
          scheduled_for: terminal
            ? new Date(now).toISOString()
            : new Date(
                now +
                  Math.min(60, 15 * Math.pow(2, attemptCount - 1)) *
                    60 *
                    1000,
              ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "Processing");
    }),
  );
}

export async function POST(request: NextRequest) {
  const secret =
    process.env.NOTIFICATION_DISPATCH_SECRET ||
    process.env.CRON_SECRET;

  if (
    !secret ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  let emailProvider;
  try {
    emailProvider = createEmailProvider(process.env, {
      trimConfiguration: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof EmailProviderConfigurationError &&
          error.message === "Brevo email delivery is not configured."
            ? "Brevo notification delivery is not configured."
            : error instanceof Error
              ? error.message
              : "Email notification delivery is not configured.",
      },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: candidates, error: queueError } = await admin
    .from("notification_email_queue")
    .select("*")
    .eq("status", "Pending")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(200);

  if (queueError) {
    return NextResponse.json(
      { error: queueError.message },
      { status: 500 },
    );
  }

  if (!candidates?.length) {
    return NextResponse.json({
      ok: true,
      provider: "Brevo",
      attemptedItems: 0,
      sentMessages: 0,
      sentItems: 0,
    });
  }

  const candidateIds = candidates.map((row: QueueRow) => row.id);

  const { data: claimed, error: claimError } = await admin
    .from("notification_email_queue")
    .update({ status: "Processing", updated_at: now })
    .in("id", candidateIds)
    .eq("status", "Pending")
    .select("*");

  if (claimError) {
    return NextResponse.json(
      { error: claimError.message },
      { status: 500 },
    );
  }

  const groups = new Map<string, QueueRow[]>();

  for (const row of (claimed ?? []) as QueueRow[]) {
    const key = [
      row.department_id,
      row.user_id,
      row.recipient_email.toLowerCase(),
    ].join("|");

    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;

  let sentMessages = 0;
  let sentItems = 0;
  let cancelledItems = 0;
  let failedGroups = 0;
  let reconciliationRequiredGroups = 0;

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const notificationKeys = Array.from(
      new Set(groupRows.map((row) => row.notification_key)),
    );

    const { data: eventRows, error: eventError } = await admin
      .from("notification_events")
      .select(
        "notification_key,fingerprint,title,detail,href,priority,source,acknowledged_at,snoozed_until,resolved_at",
      )
      .eq("department_id", first.department_id)
      .eq("user_id", first.user_id)
      .in("notification_key", notificationKeys);

    if (eventError) {
      await retryRows(admin, groupRows, "Notification event lookup failed before sending.");
      failedGroups += 1;
      continue;
    }

    const eventMap = new Map<string, EventRow>();

    for (const event of (eventRows ?? []) as EventRow[]) {
      eventMap.set(
        `${event.notification_key}|${event.fingerprint}`,
        event,
      );
    }

    const activeRows: QueueRow[] = [];
    const activeEvents: EventRow[] = [];
    const staleIds: string[] = [];

    for (const row of groupRows) {
      const event = eventMap.get(
        `${row.notification_key}|${row.fingerprint}`,
      );

      const snoozed =
        event?.snoozed_until &&
        new Date(event.snoozed_until).getTime() > Date.now();

      if (
        event &&
        !event.resolved_at &&
        !event.acknowledged_at &&
        !snoozed
      ) {
        activeRows.push(row);
        activeEvents.push(event);
      } else {
        staleIds.push(row.id);
      }
    }

    if (staleIds.length > 0) {
      await admin
        .from("notification_email_queue")
        .update({
          status: "Cancelled",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", staleIds);

      cancelledItems += staleIds.length;
    }

    if (activeRows.length === 0) continue;

    const subject =
      activeEvents.length === 1
        ? `[TracePoint] ${activeEvents[0].title}`
        : `[TracePoint] ${activeEvents.length} Inbox Items Need Attention`;

    const outcome = await deliverOutboxMessage(emailProvider, {
      to: [{ email: first.recipient_email }],
      subject,
      htmlContent: buildDigestHtml(activeEvents, siteUrl),
      textContent: buildDigestText(activeEvents, siteUrl),
    }, async (messageId) => {
      const { error } = await admin.from("notification_email_queue")
        .update({status:"Sent",sent_at:new Date().toISOString(),provider_message_id:messageId,last_error:null,updated_at:new Date().toISOString()})
        .in("id",activeRows.map(row=>row.id)).eq("status","Processing");
      if(error) throw new Error("Acceptance persistence failed.");
    });
    if(outcome.kind === "sent") {
      sentMessages += 1;
      sentItems += activeRows.length;
    } else {
      await retryRows(admin,activeRows,outcome.message,outcome.kind !== "retry",outcome.messageId);
      failedGroups += 1;
      if(outcome.kind === "reconcile") reconciliationRequiredGroups += 1;
    }
  }

  return NextResponse.json({
    ok: failedGroups === 0,
    provider: "Brevo",
    attemptedItems: claimed?.length ?? 0,
    sentMessages,
    sentItems,
    cancelledItems,
    failedGroups,
    reconciliationRequiredGroups,
  }, { status: failedGroups ? 503 : 200 });
}
