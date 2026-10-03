"use client";

import { useCallback, useEffect, useState } from "react";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type Location = {
  id: string;
  name: string;
  description?: string | null;
};

export default function SecureStorageLocationsPanel() {
  const { hasPermission } = useTracePointAccess();

  const canManage =
    hasPermission("firearm_custody.manage_storage_locations") ||
    hasPermission("manage_firearms");

  const [locations, setLocations] = useState<Location[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/armory/storage-locations", {
        cache: "no-store",
      });

      const body = (await response.json().catch(() => ({}))) as {
        locations?: Location[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Secure Storage could not be loaded.");
      }

      setLocations(body.locations ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Secure Storage could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/armory/storage-locations", {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          locations?: Location[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            body.error ?? "Secure Storage could not be loaded.",
          );
        }

        if (!cancelled) {
          setLocations(body.locations ?? []);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Secure Storage could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setError("");
    setStatus("");

    const response = await fetch("/api/armory/storage-locations", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        editing
          ? { locationId: editing, name, description }
          : { name, description },
      ),
    });

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    if (!response.ok) {
      setError(body.error ?? "Secure Storage could not be saved.");
      return;
    }

    setStatus(
      editing
        ? "Secure-storage location updated."
        : "Secure-storage location added.",
    );

    setName("");
    setDescription("");
    setEditing(null);

    await load();
  }

  async function deactivate(locationId: string) {
    setError("");
    setStatus("");

    const response = await fetch("/api/armory/storage-locations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    if (!response.ok) {
      setError(body.error ?? "Secure Storage could not be deactivated.");
      return;
    }

    setStatus("Secure-storage location deactivated.");
    await load();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-slate-400">
        Agency secure-storage locations used by firearm custody. Deactivated
        locations remain in historical custody records.
      </p>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      {status && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-2 text-xs text-emerald-200">
          {status}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-slate-400">
          Loading secure-storage locations…
        </p>
      ) : (
        <div className="space-y-2">
          {locations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-700 p-3 text-xs text-slate-400">
              No active secure-storage locations configured
            </p>
          ) : (
            locations.map((location) => (
              <div
                key={location.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 p-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">
                    {location.name}
                  </p>

                  {location.description && (
                    <p className="text-xs text-slate-400">
                      {location.description}
                    </p>
                  )}
                </div>

                {canManage && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(location.id);
                        setName(location.name);
                        setDescription(location.description ?? "");
                      }}
                      className="text-xs font-semibold text-blue-300"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => void deactivate(location.id)}
                      className="text-xs font-semibold text-rose-300"
                    >
                      Deactivate
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {canManage && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Secure storage name"
            className="rounded-xl border border-slate-700 bg-slate-950 p-2 text-sm text-white"
          />

          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description (optional)"
            className="rounded-xl border border-slate-700 bg-slate-950 p-2 text-sm text-white"
          />

          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => void save()}
            className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {editing ? "Save location" : "Add location"}
          </button>

          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setName("");
                setDescription("");
              }}
              className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-200"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}


