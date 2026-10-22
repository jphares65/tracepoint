import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import AgencyTrainingRosterBoard from "./AgencyTrainingRosterBoard.tsx";

afterEach(cleanup);

const member = (userId: string, fullName: string) => ({ userId, fullName, badgeNumber: null, rankTitle: null, unitName: null });
const attendee = (userId: string, attendanceStatus: string, outcomeStatus: string) => ({ userId, attendanceStatus, outcomeStatus, hoursCompleted: 4, scoreText: "", resultNotes: "", remedialNotes: "" });
const roster = (attendees: unknown[]) => ({ event: { id: "event-1", title: "Taser", defaultHours: 4, status: "scheduled" }, members: [member("u-a", "Alex Able"), member("u-b", "Blair Baker")], attendees, canManage: true });

type Call = { url: string; method: string; body: { attendees: Array<{ userId: string }> } | null };
function serve(handler: (call: Call, gets: number) => Response) {
  const calls: Call[] = [];
  let gets = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    // The closeout panel loads its own data; only roster requests are modelled.
    if (!call.url.endsWith("/roster")) return Response.json({});
    calls.push(call);
    if (call.method === "GET") gets += 1;
    return handler(call, gets);
  }) as typeof fetch;
  return calls;
}

test("UX-RB2-5 (B-75): an attendee with recorded attendance or results cannot be removed", async () => {
  serve(() => Response.json(roster([attendee("u-a", "present", "passed"), attendee("u-b", "assigned", "pending")])));
  render(<AgencyTrainingRosterBoard eventId="event-1" defaultHours={4} canManage />);
  const kept = await screen.findByRole("button", { name: "Alex Able cannot be removed: attendance or results are recorded" });
  assert.equal((kept as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "Remove Blair Baker" }) as HTMLButtonElement).disabled, false);
});

test("UX-RB2-5 (B-75): when the server keeps an attendee, the row comes back and the next save succeeds", async () => {
  // Blair was unrecorded when this page loaded; another instructor then recorded attendance.
  const calls = serve((call, gets) => {
    if (call.method === "GET") return Response.json(roster(gets === 1 ? [attendee("u-a", "assigned", "pending"), attendee("u-b", "assigned", "pending")] : [attendee("u-a", "assigned", "pending"), attendee("u-b", "present", "pending")]));
    const ids = call.body!.attendees.map((row) => row.userId);
    if (!ids.includes("u-b")) return Response.json({ error: "Attendance or results are recorded for a removed attendee." }, { status: 409 });
    return Response.json(roster([attendee("u-a", "assigned", "pending"), attendee("u-b", "present", "pending")]));
  });
  render(<AgencyTrainingRosterBoard eventId="event-1" defaultHours={4} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove Blair Baker" }));
  assert.equal(screen.queryByText("Blair Baker"), null);
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  assert.ok(await screen.findByText(/The attendee was put back; your other changes are kept\. Save again\./));
  assert.ok(screen.getByText("Blair Baker"));
  assert.equal((screen.getByRole("button", { name: "Blair Baker cannot be removed: attendance or results are recorded" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByRole("button", { name: /Save/ }));
  await waitFor(() => assert.equal(calls.filter((call) => call.method === "PUT").length, 2));
  await waitFor(() => assert.equal(screen.queryByText(/put back/), null));
});

test("UX-RB2-5 (B-R4): the page's Refresh reloads the board", async () => {
  const calls = serve(() => Response.json(roster([attendee("u-a", "assigned", "pending")])));
  const { rerender } = render(<AgencyTrainingRosterBoard eventId="event-1" defaultHours={4} canManage refreshKey={0} />);
  await screen.findByText("Alex Able");
  rerender(<AgencyTrainingRosterBoard eventId="event-1" defaultHours={4} canManage refreshKey={1} />);
  await waitFor(() => assert.equal(calls.filter((call) => call.method === "GET").length, 2));
});
