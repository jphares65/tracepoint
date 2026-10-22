"use client";

import { Download, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import {
  AsyncState,
  Button,
  ButtonLink,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  EntityLabel,
  Field,
  FilterBar,
  InlineNotice,
  KpiStrip,
  KpiTile,
  PageHeader,
  SavedViews,
  SegmentedControl,
  Select,
  Sheet,
  StatusChip,
  Tabs,
  TextInput,
  Textarea,
  ToastProvider,
  useToast,
  type AsyncStatus,
  type StatusRole,
} from "@/components/ui";

type Firearm = {
  id: string;
  name: string;
  meta: string;
  serial: string;
  assignedTo: string | null;
  custody: string;
  status: string;
};

// Synthetic data only, matching the blueprint mockups.
const FIREARMS: Firearm[] = [
  { id: "f1", name: "Colt AR15", meta: "Rifle · .223", serial: "123", assignedTo: "John Doe", custody: "Not recorded", status: "In service" },
  { id: "f2", name: "Glock 17", meta: "Handgun · 9mm", serial: "12345", assignedTo: "Eli Manning", custody: "Not recorded", status: "In service" },
  { id: "f3", name: "SYN-TEST Glock 17 Gen5", meta: "Handgun · 9mm", serial: "SYN-UXV-0001", assignedTo: null, custody: "In storage", status: "Inspection required" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 border-t border-line pt-6">
      <h2 id={id} className="text-section font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-8 w-8 rounded-control border border-line ${className}`} />
      <span className="font-mono text-caption text-fg-secondary">{name}</span>
    </div>
  );
}

function GalleryBody() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [answer, setAnswer] = useState<"pass" | "defect" | "na" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [asyncStatus, setAsyncStatus] = useState<AsyncStatus>("loading");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FIREARMS.filter((row) => {
      if (view === "storage" && row.custody !== "In storage") return false;
      if (view === "inspection" && row.status !== "Inspection required") return false;
      if (view === "unrecorded" && row.custody !== "Not recorded") return false;
      return !q || [row.name, row.serial, row.assignedTo ?? ""].some((value) => value.toLowerCase().includes(q));
    });
  }, [query, view]);

  const roles: StatusRole[] = ["success", "warning", "danger", "info", "neutral"];

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-16">
      <PageHeader
        title="Component gallery"
        breadcrumbs={[{ label: "Administration" }, { label: "Component gallery" }]}
        description="Every shared component and variant, for review and visual-regression snapshots. Synthetic data only."
        meta="Design system v1"
        actions={<ButtonLink href="/help" variant="quiet">Help Center</ButtonLink>}
        primaryAction={<Button variant="primary" icon={<Plus aria-hidden="true" className="h-4 w-4" />}>Primary action</Button>}
      />

      <Section id="tokens" title="Tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch name="canvas" className="bg-canvas" />
          <Swatch name="surface" className="bg-surface" />
          <Swatch name="surface-raised" className="bg-surface-raised" />
          <Swatch name="accent" className="bg-accent" />
          <Swatch name="success" className="bg-success" />
          <Swatch name="warning" className="bg-warning" />
          <Swatch name="danger" className="bg-danger" />
          <Swatch name="info" className="bg-info" />
        </div>
        <div className="space-y-1">
          <p className="text-kpi font-semibold text-fg">28–32 KPI</p>
          <p className="text-title font-semibold text-fg">24 Title</p>
          <p className="text-section font-semibold text-fg">20 Section</p>
          <p className="text-emphasis text-fg">16 Emphasis</p>
          <p className="text-body text-fg-secondary">14 Body</p>
          <p className="text-label text-fg-secondary">13 Label</p>
          <p className="text-caption text-fg-muted">12 Caption, the smallest size</p>
          <p className="font-mono text-body text-fg">SYN-UXV-0001 · NJ234 · 1,000 mi</p>
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="primary" busy busyLabel="Saving…">Save</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" icon={<Download aria-hidden="true" className="h-4 w-4" />}>Export</Button>
        </div>
      </Section>

      <Section id="status" title="Status chips">
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <StatusChip key={role} label={role} role={role} />
          ))}
          <StatusChip label="OUT_OF_SERVICE" reason="Brakes: critical defect" />
          <StatusChip label="Duty Only" reason="Restriction since Oct 1" />
          <StatusChip label="Not recorded" size="sm" />
        </div>
      </Section>

      <Section id="kpi" title="KPI tiles">
        <KpiStrip label="Readiness">
          <KpiTile label="Officers qualified" value="0/3" context="2 missing night · 1 failed" role="danger" attention href="/qualifications" />
          <KpiTile label="Vehicles available" value="1/2" context="1 out of service" role="warning" attention href="/fleet-management" />
          <KpiTile label="Firearms in service" value="7/8" context="1 inspection required" href="/firearms" />
          <KpiTile label="Upcoming range days" value={0} context="none scheduled" loading={asyncStatus === "loading"} />
        </KpiStrip>
      </Section>

      <Section id="feedback" title="Feedback and async states">
        <div className="flex flex-wrap gap-2">
          {(["loading", "error", "empty", "ready"] as const).map((status) => (
            <Button key={status} size="sm" variant={asyncStatus === status ? "primary" : "secondary"} onClick={() => setAsyncStatus(status)}>
              {status}
            </Button>
          ))}
          <Button size="sm" onClick={() => toast.success("Range day created.")}>Success toast</Button>
          <Button size="sm" onClick={() => toast.error("Couldn't save the inspection. Check your connection and submit again.")}>Error toast</Button>
        </div>
        <AsyncState
          status={asyncStatus}
          noun="equipment"
          onRetry={() => setAsyncStatus("loading")}
          empty={
            <EmptyState
              title="No equipment yet"
              description="Equipment needs a type and a storage location before items can be added."
              steps={["Add equipment types", "Add storage locations", "Add your first item"]}
              action={<Button variant="primary">Set up equipment</Button>}
            />
          }
        >
          <InlineNotice role="success" title="Loaded">Content appears here.</InlineNotice>
        </AsyncState>
        <div className="grid gap-2 md:grid-cols-2">
          <InlineNotice role="info" title="Duty Only restriction">A check-out needs supervisor approval before it is issued.</InlineNotice>
          <InlineNotice role="warning" title="2 results not synced" action={<Button size="sm">Retry</Button>}>They are kept on this device until they save.</InlineNotice>
        </div>
      </Section>

      <Section id="forms" title="Fields and controls">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Reason" required help="Recorded in custody history with your name and time.">
            {(control) => <TextInput {...control} placeholder="Failed inspection, held for armorer" />}
          </Field>
          <Field label="Storage location" error="Choose a storage location.">
            {(control) => (
              <Select {...control} defaultValue="">
                <option value="" disabled>Choose…</option>
                <option>SYN-TEST Vault</option>
              </Select>
            )}
          </Field>
          <Field label="Notes" help="Optional">
            {(control) => <Textarea {...control} />}
          </Field>
          <div className="space-y-2">
            <p className="text-label font-medium text-fg-secondary">Brakes, steering & controls</p>
            <SegmentedControl
              label="Brakes, steering & controls"
              size="field"
              value={answer}
              onChange={setAnswer}
              options={[
                { value: "pass", label: "Pass", role: "success" },
                { value: "defect", label: "Defect", role: "danger" },
                { value: "na", label: "N/A" },
              ]}
            />
            <p className="text-caption text-fg-muted">{answer ? `Answered: ${answer}` : "Not answered"}</p>
          </div>
        </div>
      </Section>

      <Section id="navigation" title="Tabs">
        <Tabs
          label="Firearm record sections"
          activeHref="/design-system"
          tabs={[
            { label: "Overview", href: "/design-system" },
            { label: "Custody", href: "/design-system?tab=custody" },
            { label: "Inspections", href: "/design-system?tab=inspections", count: 2 },
            { label: "History", href: "/design-system?tab=history" },
          ]}
        />
      </Section>

      <Section id="lists" title="Saved views, filter bar and data table">
        <SavedViews
          label="Firearm views"
          activeKey={view}
          onSelect={setView}
          views={[
            { key: "all", label: "All", count: FIREARMS.length },
            { key: "storage", label: "In storage", count: 1 },
            { key: "inspection", label: "Needs inspection", count: 1 },
            { key: "unrecorded", label: "Custody not recorded", count: 2 },
          ]}
        />
        <FilterBar
          search={{ value: query, onChange: setQuery, placeholder: "Search make, model, serial, officer" }}
          filters={
            <Select aria-label="Type" defaultValue="">
              <option value="">Type: any</option>
              <option>Handgun</option>
              <option>Rifle</option>
            </Select>
          }
          onOpenFilters={() => setSheetOpen(true)}
        />
        <DataTable<Firearm>
          caption="Department firearms"
          noun="firearms"
          rows={rows}
          getRowId={(row) => row.id}
          selectedRowId={selected}
          onRowSelect={(row) => setSelected(row.id)}
          columns={[
            { key: "firearm", header: "Firearm", sortValue: (row) => row.name, render: (row) => <EntityLabel name={row.name} meta={row.meta} /> },
            { key: "serial", header: "Serial", sortValue: (row) => row.serial, mono: true },
            { key: "assigned", header: "Assigned to", sortValue: (row) => row.assignedTo, render: (row) => row.assignedTo ?? "Unassigned" },
            { key: "custody", header: "Custody", sortValue: (row) => row.custody, render: (row) => <StatusChip label={row.custody} size="sm" /> },
            { key: "status", header: "Status", sortValue: (row) => row.status, render: (row) => <StatusChip label={row.status} size="sm" /> },
          ]}
        />
      </Section>

      <Section id="overlays" title="Dialog, sheet and confirmation">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>Retire firearm…</Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="New range day"
          description="Creates the day. You add officers next."
          footer={
            <>
              <Button variant="quiet" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => { setDialogOpen(false); toast.success("Range day created."); }}>Create range day</Button>
            </>
          }
        >
          <Field label="Date" required>{(control) => <TextInput {...control} type="date" />}</Field>
        </Dialog>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Move to secure storage"
          description="SYN-TEST Glock 17 · SYN-UXV-0001"
          auditNotice="Recorded in custody history with your name, time and reason. Assignment doesn't change."
          footer={<Button variant="primary" onClick={() => setSheetOpen(false)}>Move to SYN-TEST Vault</Button>}
        >
          <div className="space-y-4">
            <p className="text-body text-fg-secondary">
              <span className="text-fg-muted">From</span> Not recorded → <span className="text-fg-muted">To</span> SYN-TEST Vault
            </p>
            <Field label="Reason" required>{(control) => <TextInput {...control} />}</Field>
          </div>
        </Sheet>
        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => setConfirmOpen(false)}
          title="Retire SYN-TEST Glock 17?"
          impact="The firearm leaves active inventory and can't be assigned or issued. Its history is kept."
          confirmLabel="Retire firearm"
          destructive
          typedConfirmation="SYN-UXV-0001"
        />
      </Section>
    </div>
  );
}

export default function ComponentGallery() {
  return (
    <ToastProvider>
      <GalleryBody />
    </ToastProvider>
  );
}
