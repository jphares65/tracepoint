import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Button, ButtonLink } from "./Button.tsx";
import { compareSortValues, nextSort, sortRows, ariaSort } from "./data-table-core.ts";
import { DataTable } from "./DataTable.tsx";
import { EntityLabel } from "./EntityLabel.tsx";
import { AsyncState, EmptyState, InlineNotice } from "./Feedback.tsx";
import { Field, TextInput } from "./Field.tsx";
import { KpiStrip, KpiTile } from "./KpiTile.tsx";
import { PageHeader } from "./PageHeader.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";
import { StatusChip } from "./StatusChip.tsx";
import { statusRoleFor, toSentenceCase } from "./status.ts";

test("the shared status vocabulary gives each status word one role", () => {
  assert.equal(statusRoleFor("Out of service"), "danger");
  assert.equal(statusRoleFor("OUT_OF_SERVICE"), "danger");
  assert.equal(statusRoleFor("out-of-service"), "danger");
  assert.equal(statusRoleFor("In service"), "success");
  assert.equal(statusRoleFor("Not recorded"), "warning");
  assert.equal(statusRoleFor("Duty Only"), "warning");
  assert.equal(statusRoleFor("Something new"), "neutral");
  assert.equal(statusRoleFor(undefined), "neutral");
  assert.equal(toSentenceCase("INSPECTION_REQUIRED"), "Inspection required");
});

test("StatusChip shows a sentence-case label, a role and its reason", () => {
  const html = renderToStaticMarkup(<StatusChip label="OUT_OF_SERVICE" reason="Brakes: critical defect" />);
  assert.match(html, /data-status-role="danger"/);
  assert.match(html, />Out of service</);
  assert.match(html, /title="Brakes: critical defect"/);
  assert.match(html, /sr-only">: Brakes: critical defect/);
});

test("Button busy state disables, announces and relabels", () => {
  const html = renderToStaticMarkup(
    <Button variant="primary" busy busyLabel="Saving…">
      Save inspection
    </Button>,
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Saving…/);
  assert.doesNotMatch(html, /Save inspection/);
  assert.match(html, /type="button"/);
});

test("ButtonLink renders a link, not a button", () => {
  const html = renderToStaticMarkup(<ButtonLink href="/fleet-management">Open fleet</ButtonLink>);
  assert.match(html, /^<a /);
  assert.match(html, /href="\/fleet-management"/);
});

test("PageHeader renders one h1, breadcrumbs and the current crumb", () => {
  const html = renderToStaticMarkup(
    <PageHeader
      title="Firearms"
      breadcrumbs={[{ label: "Armory", href: "/firearms" }, { label: "Firearms" }]}
      primaryAction={<Button variant="primary">Add firearm</Button>}
    />,
  );
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /aria-label="Breadcrumb"/);
  assert.match(html, /aria-current="page">Firearms</);
  assert.match(html, /Add firearm/);
});

test("KpiTile stays neutral unless it needs attention, and never shows a value while loading", () => {
  const zero = renderToStaticMarkup(<KpiTile label="Out of service" value={0} role="danger" />);
  assert.match(zero, /data-status-role="neutral"/);

  const attention = renderToStaticMarkup(<KpiTile label="Out of service" value={1} role="danger" attention href="/fleet-management?status=out_of_service" />);
  assert.match(attention, /data-status-role="danger"/);
  assert.match(attention, /href="\/fleet-management\?status=out_of_service"/);

  const loading = renderToStaticMarkup(<KpiTile label="Vehicles" value={0} loading href="/fleet-management" />);
  assert.doesNotMatch(loading, />0</);
  assert.doesNotMatch(loading, /href=/);
  assert.match(loading, /Loading/);

  const failed = renderToStaticMarkup(<KpiTile label="Vehicles" value={0} error onRetry={() => {}} href="/fleet-management" />);
  assert.match(failed, /Data unavailable/);
  assert.match(failed, />Retry</);
  assert.doesNotMatch(failed, />0</);
});

test("KpiStrip sizes its grid to the tile count", () => {
  const three = renderToStaticMarkup(
    <KpiStrip label="Readiness">
      <KpiTile label="A" value={1} />
      <KpiTile label="B" value={2} />
      <KpiTile label="C" value={3} />
    </KpiStrip>,
  );
  assert.match(three, /lg:grid-cols-3/);
  assert.doesNotMatch(three, /lg:grid-cols-4/);
});

test("Field wires label, help and error to the control", () => {
  const html = renderToStaticMarkup(
    <Field label="Reason" required help="Recorded in custody history" error="Enter a reason" id="reason">
      {(control) => <TextInput {...control} />}
    </Field>,
  );
  assert.match(html, /<label for="reason"/);
  assert.match(html, /id="reason"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-required="true"/);
  assert.match(html, /aria-describedby="reason-error reason-help"/);
  assert.match(html, /role="alert"[^>]*>Enter a reason/);
});

test("AsyncState: skeleton while loading, retry on error, next step when empty", () => {
  const loading = renderToStaticMarkup(<AsyncState status="loading" noun="vehicles">ready</AsyncState>);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading vehicles/);
  assert.doesNotMatch(loading, /ready/);

  const error = renderToStaticMarkup(<AsyncState status="error" noun="vehicles" onRetry={() => {}} />);
  assert.match(error, /role="alert"/);
  assert.match(error, /Couldn&#x27;t load vehicles/);
  assert.match(error, />Retry</);

  const empty = renderToStaticMarkup(
    <AsyncState status="empty" noun="equipment" empty={<EmptyState title="No equipment yet" steps={["Add a type", "Add a location"]} />} />,
  );
  assert.match(empty, /No equipment yet/);
  assert.match(empty, /<ol/);
});

test("InlineNotice announces danger immediately and other roles politely", () => {
  assert.match(renderToStaticMarkup(<InlineNotice role="danger" title="Not saved" />), /role="alert"/);
  assert.match(renderToStaticMarkup(<InlineNotice role="success" title="Saved" />), /role="status"/);
});

test("SegmentedControl starts unanswered with one tab stop", () => {
  const html = renderToStaticMarkup(
    <SegmentedControl
      label="Brakes"
      value={null}
      onChange={() => {}}
      size="field"
      options={[
        { value: "pass", label: "Pass", role: "success" },
        { value: "defect", label: "Defect", role: "danger" },
        { value: "na", label: "N/A" },
      ]}
    />,
  );
  assert.match(html, /role="radiogroup" aria-label="Brakes"/);
  assert.equal(html.match(/aria-checked="true"/g), null);
  assert.equal(html.match(/tabindex="0"/g)?.length, 1);
  assert.match(html, /min-h-11/);
});

test("EntityLabel never falls back to a raw id", () => {
  const html = renderToStaticMarkup(<EntityLabel name={null} identifier="SYN-UXV-0001" />);
  assert.match(html, /Unnamed record/);
  assert.match(html, /font-mono[^>]*>SYN-UXV-0001/);
});

test("DataTable renders sortable headers, a table and a phone card list", () => {
  type Row = { id: string; unit: string; status: string };
  const html = renderToStaticMarkup(
    <DataTable<Row>
      caption="Vehicles"
      noun="vehicles"
      rows={[
        { id: "1", unit: "105", status: "Available" },
        { id: "2", unit: "SYN-901", status: "Out of service" },
      ]}
      getRowId={(row) => row.id}
      onRowSelect={() => {}}
      columns={[
        { key: "unit", header: "Unit", sortValue: (row) => row.unit, mono: true },
        { key: "status", header: "Status", render: (row) => <StatusChip label={row.status} /> },
      ]}
    />,
  );
  assert.match(html, /<caption class="sr-only">Vehicles<\/caption>/);
  assert.match(html, /aria-sort="none"/);
  assert.match(html, /<ul aria-label="Vehicles" class="space-y-2 sm:hidden"/);
  assert.equal(html.match(/data-status-role="danger"/g)?.length, 2);

  const empty = renderToStaticMarkup(
    <DataTable<Row> caption="Vehicles" noun="vehicles" rows={[]} getRowId={(row) => row.id} columns={[]} />,
  );
  assert.match(empty, /No vehicles yet/);
});

test("data-table-core sorts stably, keeps empty values last and cycles sort state", () => {
  assert.ok(compareSortValues("Unit 9", "Unit 10") < 0);
  assert.ok(compareSortValues(null, "a") > 0);
  assert.ok(compareSortValues(null, "a", "desc") > 0);
  const rows = [
    { id: "a", n: 2 },
    { id: "b", n: 1 },
    { id: "c", n: 2 },
  ];
  assert.deepEqual(
    sortRows(rows, { key: "n", direction: "desc" }, (row) => row.n).map((row) => row.id),
    ["a", "c", "b"],
  );
  assert.equal(nextSort(null, "n")?.direction, "asc");
  assert.equal(nextSort({ key: "n", direction: "asc" }, "n")?.direction, "desc");
  assert.equal(nextSort({ key: "n", direction: "desc" }, "n"), null);
  assert.equal(ariaSort({ key: "n", direction: "desc" }, "n"), "descending");
});
