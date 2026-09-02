import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createAgencyTrainingReadRepository } from "@/lib/agency-training/read-repository";
type RouteContext = { params: Promise<{ eventId: string }> };
function csv(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
export async function GET(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { eventId } = await routeContext.params;
  try {
  const data = await createAgencyTrainingReadRepository(context.admin, context.departmentId).getReport({ departmentId: context.departmentId, eventId });
  if (!data) return NextResponse.json({ error: "Training event not found." }, { status: 404 });
  const names = new Map(data.profiles.map((row: any) => [String(row.id), row.full_name]));
  const headers = ["Event","Start","Location","Status","Personnel","Attendance","Outcome","Hours","Score / Result","Notes","Remediation"];
  const lines = [headers.map(csv).join(",")];
  for (const row of data.attendees) lines.push([
    data.event.title, data.event.starts_at, data.event.location, data.event.status,
    names.get(String(row.user_id)) ?? "Department Member", row.attendance_status,
    row.outcome_status, row.hours_completed, row.score_text, row.result_notes, row.remedial_notes,
  ].map(csv).join(","));
  const file = String(data.event.title).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "training-event";
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}-completed-report.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Training report could not be loaded." }, { status: 500 }); }
}
