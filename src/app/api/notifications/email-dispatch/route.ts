import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient() as any;
  const { data: rows, error } = await admin
    .from("notification_email_queue")
    .select("*")
    .eq("status", "Pending")
    .lte("scheduled_for", new Date().toISOString())
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.TRACEPOINT_FROM_EMAIL;
  if (!apiKey || !from) {
    return NextResponse.json({ ok: true, providerConfigured: false, pending: rows?.length ?? 0 });
  }

  let sent = 0;
  for (const row of rows ?? []) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [row.recipient_email], subject: row.subject, text: row.body_text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `Resend returned ${response.status}.`);

      await admin.from("notification_email_queue").update({
        status: "Sent",
        sent_at: new Date().toISOString(),
        provider_message_id: payload?.id ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      sent += 1;
    } catch (sendError) {
      await admin.from("notification_email_queue").update({
        status: "Failed",
        last_error: sendError instanceof Error ? sendError.message : "Send failed.",
        attempt_count: Number(row.attempt_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
  }

  return NextResponse.json({ ok: true, providerConfigured: true, attempted: rows?.length ?? 0, sent });
}
