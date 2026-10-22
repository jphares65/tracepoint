"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { cx } from "./cx";
import { STATUS_ROLE_CLASSES } from "./status";

export type ToastRole = "success" | "danger" | "info";

type ToastItem = { id: number; role: ToastRole; message: string };

type ToastApi = {
  /** Confirms a completed action in plain words: "Range day created." */
  success: (message: string) => void;
  /** An error that says the next step. Errors stay until dismissed. */
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 5000;

/** Mount once near the root of a client tree. Contract: COMPONENTS.md#toast */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (role: ToastRole, message: string) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-2), { id, role, message }]);
      if (role !== "danger") window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("danger", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
        {items.map((item) => (
          <div
            key={item.id}
            role={item.role === "danger" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-line-strong bg-surface-raised px-4 py-3 shadow-2xl"
          >
            <span aria-hidden="true" className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS_ROLE_CLASSES[item.role].dot)} />
            <p className="min-w-0 flex-1 text-body text-fg">{item.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
              className="rounded-control p-1 text-fg-muted hover:text-fg"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}
