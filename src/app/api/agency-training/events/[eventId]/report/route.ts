import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
type RouteContext = { params: Promise<{ eventId: string }> };
function csv(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
export async function GET(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { eventId } = await routeContext.params;
  const event = await context.admin.from("agency_training_events").select("*").eq("department_id", context.departmentId).eq("id", eventId).maybeSingle();
  if (event.error) return NextResponse.json({ error: event.error.message }, { status: 500 });
  if (!event.data) return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  const attendees = await context.admin.from("agency_training_attendees").select("*").eq("department_id", context.departmentId).eq("event_id", eventId).order("created_at");
  if (attendees.error) return NextResponse.json({ error: attendees.error.message }, { status: 500 });
  const userIds = (attendees.data ?? []).map((row: any) => row.user_id);
  const profiles = userIds.length ? await context.admin.from("profiles").select("id,full_name").in("id", userIds) : { data: [], error: null };
  if (profiles.error) return NextResponse.json({ error: profiles.error.message }, { status: 500 });
  const names = new Map((profiles.data ?? []).map((row: any) => [String(row.id), row.full_name]));
  const headers = ["Event","Start","Location","Status","Personnel","Attendance","Outcome","Hours","Score / Result","Notes","Remediation"];
  const lines = [headers.map(csv).join(",")];
  for (const row of attendees.data ?? []) lines.push([
    event.data.title, event.data.starts_at, event.data.location, event.data.status,
    names.get(String(row.user_id)) ?? "Department Member", row.attendance_status,
    row.outcome_status, row.hours_completed, row.score_text, row.result_notes, row.remedial_notes,
  ].map(csv).join(","));
  const file = event.data.title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "training-event";
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}-completed-report.csv"`, "Cache-Control": "private, no-store" } });
}