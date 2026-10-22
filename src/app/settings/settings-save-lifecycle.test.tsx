/* eslint-disable @typescript-eslint/no-explicit-any -- module stubs and a fetch double */
import "@/lib/testing/dom";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";
import type { ReactNode } from "react";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// SV-29 and WP-5 (E-02, E-04, E-06, E-07, AE-R1): the Settings page save
// lifecycle, rendered whole. Only the shell (layout chrome) and the access hook
// are replaced; every save goes through the page's real handlers and fetch.
const require = createRequire(import.meta.url);
const stub = (path: string, exports: Record<string, unknown>) => { require.cache[path] = { id: path, filename: path, loaded: true, exports } as any; };
const DEPARTMENT = "eeeeeeee-0000-4000-8000-00000000000a";
const ADMIN = "b0000000-0000-4000-8000-0000000000a1";
const OFFICER = "b0000000-0000-4000-8000-0000000000c1";
const GROUP = "b0000000-0000-4000-8000-0000000000f1";
stub(require.resolve("../components/TracePointShell.tsx"), { default: ({ children }: { children: ReactNode }) => children, __esModule: true });
// One stable value, as the real hook returns between access changes.
const access = {
  loading: false, userId: ADMIN, departmentId: DEPARTMENT, permissions: ["administer_department"],
  hasPermission: () => true, refresh: async () => {},
};
stub(require.resolve("../../lib/tracepoint/useTracePointAccess.ts"), { useTracePointAccess: () => access });

// The page dispatches CustomEvents; Node's own class are not accepted by the jsdom window the page dispatches on.
Object.assign(globalThis, { CustomEvent: window.CustomEvent });

// The whole page renders under a loaded test runner; allow it time.
configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);

type Call = { url: string; method: string; body: any };
type Handler = (call: Call) => Response | Promise<Response> | undefined;

// The server state the double serves, so a refresh after a save returns what was written.
function server(overrides: Handler = () => undefined) {
  const state = {
    rules: {
      department_id: DEPARTMENT, spring_cycle_start: "04-01", spring_cycle_end: "06-30", fall_cycle_start: "09-01", fall_cycle_end: "11-30",
      require_rifle_familiarization: true, qualification_valid_days: 365, qualification_due_soon_days: 30, inspection_interval_days: 180,
      battery_check_interval_days: 180, off_duty_renewal_days: 365, allow_personally_owned_rifles: false,
      require_personal_rifle_armorer_inspection: true, require_personal_rifle_chief_approval: true, require_personal_rifle_qualification: true,
      require_personal_rifle_annual_reinspection: true, require_personal_rifle_spec_acknowledgment: true,
      require_off_duty_inspection: true, require_off_duty_qualification: true, inspection_due_soon_days: 30,
    } as Record<string, any>,
  };
  const calls: Call[] = [];
  const offDuty = () => ({
    requireInspection: state.rules.require_off_duty_inspection, requireQualification: state.rules.require_off_duty_qualification,
    renewalDays: state.rules.off_duty_renewal_days, inspectionIntervalDays: state.rules.inspection_interval_days,
    inspectionDueSoonDays: state.rules.inspection_due_soon_days,
  });
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const custom = await overrides(call);
    if (custom) return custom;
    if (call.url === "/api/settings/overview") {
      return Response.json({
        department: { id: DEPARTMENT, name: "Dept A", short_name: "DA", accent_color: "blue", login_theme: "dark" },
        rules: { ...state.rules }, security: null, roles: [{ code: "officer", display_name: "Officer", sort_order: 1 }], permissions: [], rolePermissions: [],
        members: [{ user_id: OFFICER, full_name: "Olive Officer", email: "olive@example.test", is_active: true, role_codes: ["officer"], effective_permissions: [] }],
      });
    }
    if (call.url.startsWith("/api/settings/audit-log")) return Response.json({ events: [] });
    if (call.url === "/api/settings/off-duty-rules" && call.method === "GET") return Response.json({ rules: offDuty() });
    if (call.url === "/api/settings/off-duty-rules" && call.method === "PATCH") {
      Object.assign(state.rules, {
        require_off_duty_inspection: call.body.requireInspection, require_off_duty_qualification: call.body.requireQualification,
        off_duty_renewal_days: call.body.renewalDays, inspection_interval_days: call.body.inspectionIntervalDays, inspection_due_soon_days: call.body.inspectionDueSoonDays,
      });
      return Response.json({ rules: offDuty() });
    }
    if (call.url === "/api/settings/data" && call.body?.table === "department_rules" && call.body.operation === "upsert") {
      Object.assign(state.rules, call.body.payload);
      return Response.json({ data: null });
    }
    if (call.url === "/api/settings/data" && call.body?.table === "department_groups") {
      return Response.json({ data: [{ id: GROUP, name: "Day Shift", is_active: true, department_id: DEPARTMENT }] });
    }
    if (call.url === "/api/settings/data" && call.body?.table === "department_group_members") {
      return Response.json({ data: [{ group_id: GROUP }] });
    }
    if (call.url === "/api/settings/data") return Response.json({ data: [] });
    return Response.json({});
  }) as typeof fetch;
  return { calls, state };
}

async function renderSettings() {
  const { default: AdminSettingsPage } = await import("./page.tsx");
  render(<AdminSettingsPage />);
  await screen.findByRole("heading", { name: "Admin Settings" });
  await waitFor(() => assert.equal(screen.queryByText("Loading department settings...") === null, true));
}

async function openRules(subTab: string) {
  fireEvent.click(screen.getByRole("button", { name: /Rules Engine/ }));
  await screen.findByRole("heading", { name: "Agency Rules" });
  fireEvent.click(screen.getAllByRole("button", { name: subTab })[0]);
}

test("SV-29: an Off-Duty change is saved by a button that names it, persists, and the confirmation stays visible", async () => {
  const { calls, state } = server();
  await renderSettings();
  await openRules("Off-Duty Firearms");
  const inspection = await screen.findByRole("checkbox", { name: /Require Department Inspection/ });
  fireEvent.click(inspection);
  assert.equal((inspection as HTMLInputElement).checked, false);

  // The header no longer offers a "Save Rules Engine" that saves something else.
  // (A failing assertion must not print a DOM node: inspecting one takes minutes.)
  assert.equal(screen.queryByRole("button", { name: /Save Rules Engine/ }) === null, true, "no header Save Rules Engine");
  fireEvent.click(screen.getByRole("button", { name: "Save Off-Duty Rules" }));

  await waitFor(() => assert.equal(calls.filter((call) => call.method === "PATCH").length, 1));
  assert.equal(state.rules.require_off_duty_inspection, false, "the server stored the change");
  const status = await screen.findByRole("status", { name: /Off-Duty Rules save status/ });
  assert.match(status.textContent ?? "", /Off-duty firearm rules saved\./);
  // The panel stays mounted and shows the server's value.
  assert.equal((screen.getByRole("checkbox", { name: /Require Department Inspection/ }) as HTMLInputElement).checked, false);
  assert.equal(calls.filter((call) => call.body?.table === "department_rules").length, 0, "no stale operational-rules write");
});

test("E-04: the Armory save names its scope, sends only Armory fields, and its confirmation survives the refresh (AE-R1, E-07)", async () => {
  const { calls, state } = server();
  state.rules.off_duty_renewal_days = 400;
  await renderSettings();
  await openRules("Armory");
  const field = await screen.findByLabelText("Battery check interval");
  fireEvent.change(field, { target: { value: "90" } });
  const save = screen.getByRole("button", { name: "Save Armory Rules" });
  fireEvent.click(save);

  await waitFor(() => assert.equal(calls.filter((call) => call.body?.operation === "upsert").length, 1));
  const payload = calls.find((call) => call.body?.operation === "upsert")!.body.payload;
  assert.equal(payload.battery_check_interval_days, 90);
  for (const owned of ["off_duty_renewal_days", "require_rifle_familiarization", "spring_cycle_start", "qualification_valid_days"]) {
    assert.equal(owned in payload, false, `${owned} is not part of the Armory save`);
  }
  const status = await screen.findByRole("status", { name: /Armory Rules save status/ });
  await waitFor(() => assert.ok(calls.filter((call) => call.url === "/api/settings/overview").length >= 2, "the page re-read the saved rules"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.ok(status.isConnected, "the tab was not unmounted by the refresh");
  assert.match(status.textContent ?? "", /Armory rules saved\./);
  assert.equal(((screen.getByLabelText("Battery check interval")) as HTMLInputElement).value, "90");
  assert.equal(state.rules.off_duty_renewal_days, 400, "the off-duty renewal was not overwritten");
});

test("E-04: a refused save is reported next to the button that was pressed", async () => {
  server((call) => call.body?.operation === "upsert" ? Response.json({ error: "Battery interval refused." }, { status: 400 }) : undefined);
  await renderSettings();
  await openRules("Armory");
  fireEvent.change(await screen.findByLabelText("Battery check interval"), { target: { value: "91" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Armory Rules" }));
  const alert = await screen.findByRole("alert", { name: /Armory Rules save status/ });
  assert.match(alert.textContent ?? "", /Battery interval refused\./);
});

test("E-06: leaving a sub-tab with unsaved rules asks first, and keeping them stays put", async () => {
  server();
  await renderSettings();
  await openRules("Armory");
  fireEvent.change(await screen.findByLabelText("Battery check interval"), { target: { value: "45" } });
  assert.ok(screen.getByText("Unsaved changes"));
  fireEvent.click(screen.getAllByRole("button", { name: "Off-Duty Firearms" })[0]);
  const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  assert.equal(((screen.getByLabelText("Battery check interval")) as HTMLInputElement).value, "45");
  fireEvent.click(screen.getAllByRole("button", { name: "Off-Duty Firearms" })[0]);
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).getByRole("button", { name: "Discard changes" }));
  await screen.findByRole("checkbox", { name: /Require Department Inspection/ });
});

test("E-06: the page warns before unload while rules are unsaved", async () => {
  server();
  await renderSettings();
  await openRules("Armory");
  const clean = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  assert.equal(clean.defaultPrevented, false);
  fireEvent.change(await screen.findByLabelText("Battery check interval"), { target: { value: "46" } });
  const dirty = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  assert.equal(dirty.defaultPrevented, true);
});

test("E-02: Save Access waits for the member's groups, and a failed load leaves groups unchanged", async () => {
  let releaseGroups: (response: Response) => void = () => {};
  const { calls } = server((call) => {
    if (call.body?.table === "department_group_members" && call.body.operation === "select") {
      return new Promise<Response>((resolve) => { releaseGroups = resolve; });
    }
    return undefined;
  });
  await renderSettings();
  fireEvent.click(screen.getByRole("button", { name: /Users & Roles/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Edit Access/ }));
  const save = await screen.findByRole("button", { name: /Save Access/ });
  assert.equal((save as HTMLButtonElement).disabled, true, "Save waits for the groups to load");
  await act(async () => { releaseGroups(Response.json({ error: "unavailable" }, { status: 500 })); });
  await screen.findByText(/Group assignments could not be loaded\. Saving keeps this member's current groups\./);
  await waitFor(() => assert.equal((screen.getByRole("button", { name: /Save Access/ }) as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole("button", { name: /Save Access/ }));
  await waitFor(() => assert.equal(calls.filter((call) => call.body?.rpc === "save_department_member").length, 1));
  const args = calls.find((call) => call.body?.rpc === "save_department_member")!.body.args;
  assert.equal("p_group_ids" in args, false, "no group list is sent, so the server keeps the memberships");
  assert.ok(await screen.findByText("Olive Officer's access was updated."), "the success notice is shown (AE-R1)");
});

test("E-02: once the member's groups load, Save Access sends them", async () => {
  const { calls } = server();
  await renderSettings();
  fireEvent.click(screen.getByRole("button", { name: /Users & Roles/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Edit Access/ }));
  await screen.findByRole("button", { name: /✓ Day Shift/ });
  fireEvent.click(screen.getByRole("button", { name: /Save Access/ }));
  await waitFor(() => assert.equal(calls.filter((call) => call.body?.rpc === "save_department_member").length, 1));
  assert.deepEqual(calls.find((call) => call.body?.rpc === "save_department_member")!.body.args.p_group_ids, [GROUP]);
});

test("AE-R1: a header save's success notice is still shown after the refresh that follows it", async () => {
  const { calls } = server((call) => call.body?.table === "department_security_settings" ? Response.json({ data: null }) : undefined);
  await renderSettings();
  fireEvent.click(screen.getByRole("button", { name: /Audit & Security/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Save Audit & Security/ }));
  await waitFor(() => assert.ok(calls.filter((call) => call.url === "/api/settings/overview").length >= 2));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.match(screen.getByRole("status").textContent ?? "", /Security policy settings saved\./);
});

test("SV-29: an Off-Duty inspection validity change is not overwritten by a later Armory save", async () => {
  const { calls, state } = server();
  await renderSettings();
  await openRules("Off-Duty Firearms");
  const validity = await screen.findByRole("spinbutton", { name: /Inspection validity/ });
  fireEvent.change(validity, { target: { value: "120" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Off-Duty Rules" }));
  await screen.findByRole("status", { name: /Off-Duty Rules save status/ });
  assert.equal(state.rules.inspection_interval_days, 120);

  fireEvent.click(screen.getAllByRole("button", { name: "Armory" })[0]);
  assert.equal(screen.queryByRole("dialog") === null, true, `no discard prompt: ${screen.queryByRole("dialog")?.textContent}`);
  assert.equal((await screen.findByLabelText("Inspection interval") as HTMLInputElement).value, "120");
  fireEvent.change(screen.getByLabelText("Battery check interval"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Armory Rules" }));
  await waitFor(() => assert.equal(calls.filter((call) => call.body?.operation === "upsert").length, 1));
  assert.equal(state.rules.inspection_interval_days, 120);
  assert.equal(state.rules.battery_check_interval_days, 60);
});

test("E-06: Refresh with unsaved rules asks first; discarding re-reads the saved rules", async () => {
  const { calls } = server();
  await renderSettings();
  await openRules("Armory");
  fireEvent.change(await screen.findByLabelText("Battery check interval"), { target: { value: "47" } });
  const reads = calls.filter((call) => call.url === "/api/settings/overview").length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
  assert.match(dialog.textContent ?? "", /Armory Rules/);
  assert.equal(calls.filter((call) => call.url === "/api/settings/overview").length, reads, "nothing reloads before the choice");
  fireEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
  await waitFor(() => assert.equal((screen.getByLabelText("Battery check interval") as HTMLInputElement).value, "180"));
  await waitFor(() => assert.equal(calls.filter((call) => call.url === "/api/settings/overview").length, reads + 1));
});
