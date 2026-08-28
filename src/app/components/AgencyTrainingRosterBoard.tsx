"use client";

import {
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AgencyTrainingCloseoutPanel from "@/app/components/AgencyTrainingCloseoutPanel";

type Member = {
  userId: string;
  fullName: string;
  badgeNumber: string | null;
  rankTitle: string | null;
  unitName: string | null;
};

type RosterRow = Member & {
  id?: string;
  attendanceStatus: "assigned" | "present" | "excused" | "no_show";
  outcomeStatus:
    | "pending"
    | "completed"
    | "passed"
    | "failed"
    | "incomplete"
    | "remedial_required";
  hoursCompleted: number | string | null;
  scoreText: string;
  resultNotes: string;
  remedialNotes: string;
};

type RosterPayload = {
  event?: { id: string; title: string; defaultHours: number | null; status: string };
  members?: Member[];
  attendees?: Array<Partial<RosterRow> & { userId: string }>;
  canManage?: boolean;
  error?: string;
};

type Props = {
  eventId: string;
  defaultHours: number | null;
  canManage: boolean;
  onSaved?: (attendeeCount: number, completedCount: number) => void;
};

function normalizedRow(member: Member, value?: Partial<RosterRow>): RosterRow {
  return {
    ...member,
    id: value?.id,
    attendanceStatus: value?.attendanceStatus ?? "assigned",
    outcomeStatus: value?.outcomeStatus ?? "pending",
    hoursCompleted: value?.hoursCompleted ?? null,
    scoreText: value?.scoreText ?? "",
    resultNotes: value?.resultNotes ?? "",
    remedialNotes: value?.remedialNotes ?? "",
  };
}

function resultComplete(status: RosterRow["outcomeStatus"]) {
  return status === "completed" || status === "passed";
}

export default function AgencyTrainingRosterBoard({
  eventId,
  defaultHours,
  canManage: pageCanManage,
  onSaved,
}: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [canManage, setCanManage] = useState(pageCanManage);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showPersonnel, setShowPersonnel] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [eventStatus, setEventStatus] = useState("");

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/agency-training/events/${encodeURIComponent(eventId)}/roster`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as RosterPayload;
      if (!response.ok) {
        throw new Error(payload.error || "The training roster could not be loaded.");
      }

      const nextMembers = payload.members ?? [];
      const memberMap = new Map(nextMembers.map((member) => [member.userId, member]));
      const nextRows = (payload.attendees ?? []).map((attendee) =>
        normalizedRow(
          memberMap.get(attendee.userId) ?? {
            userId: attendee.userId,
            fullName: attendee.fullName ?? "Former Member",
            badgeNumber: attendee.badgeNumber ?? null,
            rankTitle: attendee.rankTitle ?? null,
            unitName: attendee.unitName ?? null,
          },
          attendee,
        ),
      );

      setMembers(nextMembers);
      setRows(nextRows);
      setEventStatus(payload.event?.status ?? "");
      setCanManage(
        payload.canManage === true &&
          pageCanManage &&
          payload.event?.status !== "completed",
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The training roster could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [eventId, pageCanManage]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const assignedIds = useMemo(() => new Set(rows.map((row) => row.userId)), [rows]);
  const availableMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return members.filter((member) => {
      if (assignedIds.has(member.userId)) return false;
      if (!query) return true;
      return [member.fullName, member.badgeNumber, member.rankTitle, member.unitName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [assignedIds, members, search]);

  const completedCount = rows.filter((row) => resultComplete(row.outcomeStatus)).length;

  function updateRow(userId: string, patch: Partial<RosterRow>) {
    setSaved(false);
    setRows((current) =>
      current.map((row) => (row.userId === userId ? { ...row, ...patch } : row)),
    );
  }

  function addSelectedPersonnel() {
    const selectedMembers = members.filter((member) => selectedIds.includes(member.userId));
    setRows((current) => [
      ...current,
      ...selectedMembers.map((member) =>
        normalizedRow(member, {
          hoursCompleted: defaultHours,
        }),
      ),
    ]);
    setSelectedIds([]);
    setSearch("");
    setShowPersonnel(false);
    setSaved(false);
  }

  async function saveRoster() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError("");

    try {
      const response = await fetch(
        `/api/agency-training/events/${encodeURIComponent(eventId)}/roster`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attendees: rows.map((row) => ({
              userId: row.userId,
              attendanceStatus: row.attendanceStatus,
              outcomeStatus: row.outcomeStatus,
              hoursCompleted: row.hoursCompleted,
              scoreText: row.scoreText,
              resultNotes: row.resultNotes,
              remedialNotes: row.remedialNotes,
            })),
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as RosterPayload;
      if (!response.ok) {
        throw new Error(payload.error || "The roster could not be saved.");
      }

      const memberMap = new Map(members.map((member) => [member.userId, member]));
      const nextRows = (payload.attendees ?? []).map((attendee) =>
        normalizedRow(memberMap.get(attendee.userId) ?? rows.find((row) => row.userId === attendee.userId)!, attendee),
      );
      setRows(nextRows);
      setSaved(true);
      onSaved?.(
        nextRows.length,
        nextRows.filter((row) => resultComplete(row.outcomeStatus)).length,
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The roster could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/35 px-4 py-16 text-sm text-slate-500">
        <Loader2 size={17} className="animate-spin" /> Loading roster
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-blue-500/20 bg-slate-950/25 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
            Live Training Board
          </p>
          <h3 className="mt-1 text-base font-bold text-white">Roster & Results</h3>
          <p className="mt-1 text-xs text-slate-500">
            {rows.length} assigned / {completedCount} completed
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowPersonnel(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-bold text-slate-200 hover:border-blue-500/50"
            >
              <UserRoundPlus size={15} /> Add Personnel
            </button>
            <button
              type="button"
              onClick={() => void saveRoster()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Save All
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-200">
          <CheckCircle2 size={15} /> Roster and results saved
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center">
          <Users size={26} className="mx-auto text-slate-600" />
          <p className="mt-3 text-sm font-bold text-slate-300">No personnel assigned</p>
          <p className="mt-1 text-xs text-slate-500">
            Add personnel to build this event's working roster.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-[1050px] w-full border-collapse text-left">
            <thead className="bg-slate-950/70">
              <tr className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                <th className="px-4 py-3">Personnel</th>
                <th className="px-3 py-3">Attendance</th>
                <th className="px-3 py-3">Outcome</th>
                <th className="px-3 py-3">Hours</th>
                <th className="px-3 py-3">Score / Result</th>
                <th className="px-3 py-3">Notes</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row) => (
                <tr key={row.userId} className="bg-slate-900/30 align-top">
                  <td className="px-4 py-3">
                    <p className="text-xs font-bold text-white">{row.fullName}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {[row.rankTitle, row.badgeNumber ? `#${row.badgeNumber}` : null]
                        .filter(Boolean)
                        .join(" / ") || "Department member"}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={row.attendanceStatus}
                      disabled={!canManage}
                      onChange={(event) =>
                        updateRow(row.userId, {
                          attendanceStatus: event.target.value as RosterRow["attendanceStatus"],
                        })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-blue-500"
                    >
                      <option value="assigned">Assigned</option>
                      <option value="present">Present</option>
                      <option value="excused">Excused</option>
                      <option value="no_show">No Show</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={row.outcomeStatus}
                      disabled={!canManage}
                      onChange={(event) => {
                        const outcomeStatus = event.target.value as RosterRow["outcomeStatus"];
                        updateRow(row.userId, {
                          outcomeStatus,
                          attendanceStatus:
                            outcomeStatus === "pending" ? row.attendanceStatus : "present",
                        });
                      }}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-blue-500"
                    >
                      <option value="pending">Pending</option>
                      <option value="completed">Completed</option>
                      <option value="passed">Passed</option>
                      <option value="failed">Failed</option>
                      <option value="incomplete">Incomplete</option>
                      <option value="remedial_required">Remedial Required</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={row.hoursCompleted ?? ""}
                      disabled={!canManage}
                      onChange={(event) =>
                        updateRow(row.userId, { hoursCompleted: event.target.value })
                      }
                      className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      value={row.scoreText}
                      disabled={!canManage}
                      onChange={(event) =>
                        updateRow(row.userId, { scoreText: event.target.value })
                      }
                      placeholder="Optional"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      value={row.resultNotes}
                      disabled={!canManage}
                      onChange={(event) =>
                        updateRow(row.userId, { resultNotes: event.target.value })
                      }
                      placeholder="Instructor notes"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="px-3 py-3">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRows((current) =>
                            current.filter((item) => item.userId !== row.userId),
                          );
                          setSaved(false);
                        }}
                        className="rounded-lg border border-slate-700 p-2 text-slate-500 hover:border-rose-500/50 hover:text-rose-300"
                        aria-label={`Remove ${row.fullName}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AgencyTrainingCloseoutPanel
        eventId={eventId}
        eventStatus={eventStatus}
        canManage={pageCanManage}
        onClosed={() => {
          setEventStatus("completed");
          setCanManage(false);
          void loadRoster();
        }}
      />

      {showPersonnel ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-400">
                  Event Roster
                </p>
                <h4 className="mt-1 text-lg font-bold text-white">Add Personnel</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowPersonnel(false)}
                className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3">
                <Search size={15} className="text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search personnel"
                  className="w-full bg-transparent py-3 text-sm text-white outline-none"
                />
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {availableMembers.length === 0 ? (
                  <p className="px-3 py-10 text-center text-xs text-slate-500">
                    No additional active personnel match this search.
                  </p>
                ) : (
                  availableMembers.map((member) => (
                    <label
                      key={member.userId}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 hover:border-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(member.userId)}
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, member.userId]
                              : current.filter((id) => id !== member.userId),
                          )
                        }
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span className="min-w-0">
                        <strong className="block truncate text-xs text-white">
                          {member.fullName}
                        </strong>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {[member.rankTitle, member.badgeNumber ? `#${member.badgeNumber}` : null]
                            .filter(Boolean)
                            .join(" / ") || "Department member"}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowPersonnel(false)}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addSelectedPersonnel}
                disabled={selectedIds.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
              >
                <Plus size={14} /> Add {selectedIds.length || "Selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}