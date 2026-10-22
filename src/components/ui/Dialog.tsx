"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "./Button";
import { cx } from "./cx";
import { InlineNotice } from "./Feedback";

type Placement = "center" | "side";

type ModalFrameProps = {
  open: boolean;
  /** Called on Escape, the close button and backdrop clicks. Not called while busy. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** An API error shown above the footer, so the person can fix and resubmit. */
  error?: ReactNode;
  busy?: boolean;
  /** Unsaved input. Closing asks "Discard your changes?" inside the dialog first. */
  dirty?: boolean;
  placement: Placement;
  className?: string;
};

/**
 * Native <dialog> opened with showModal(): focus is trapped, the rest of the page is
 * inert, and focus returns to the opener on close.
 */
function ModalFrame({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  error,
  busy = false,
  dirty = false,
  placement,
  className,
}: ModalFrameProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function requestClose() {
    if (busy) return;
    if (dirty && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    setConfirmingDiscard(false);
    onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) requestClose();
      }}
      className={cx(
        "m-0 max-h-none max-w-none border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-transparent",
        placement === "center"
          ? "fixed inset-0 m-auto h-fit max-h-[90vh] w-[min(36rem,calc(100vw-2rem))] rounded-card border"
          : "fixed inset-y-0 right-0 left-auto h-full w-full border-l sm:w-[30rem] max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:h-auto max-sm:max-h-[90vh] max-sm:rounded-t-card max-sm:border-t max-sm:border-l-0",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 space-y-1">
              <h2 id={titleId} className="text-section font-semibold text-fg">
                {title}
              </h2>
              {description ? (
                <div id={descriptionId} className="text-body text-fg-muted">
                  {description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={busy}
              aria-label="Close"
              className="tp-touch-target rounded-control p-1.5 text-fg-muted hover:bg-surface-raised hover:text-fg disabled:opacity-50"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {confirmingDiscard ? (
            <div className="px-5 pb-3">
              <InlineNotice
                role="warning"
                title="Discard your changes?"
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="quiet" onClick={() => setConfirmingDiscard(false)}>
                      Keep editing
                    </Button>
                    <Button size="sm" variant="destructive" onClick={requestClose}>
                      Discard
                    </Button>
                  </div>
                }
              >
                What you entered here hasn&apos;t been saved.
              </InlineNotice>
            </div>
          ) : null}
          {error ? (
            <div className="px-5 pb-3">
              <InlineNotice role="danger" title="This wasn't saved">
                {error}
              </InlineNotice>
            </div>
          ) : null}
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 max-sm:sticky max-sm:bottom-0 max-sm:bg-surface">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

export type DialogProps = Omit<ModalFrameProps, "placement">;

/** Short creates (the Training Event pattern). Contract: COMPONENTS.md#dialog */
export function Dialog(props: DialogProps) {
  return <ModalFrame {...props} placement="center" />;
}

export type SheetProps = Omit<ModalFrameProps, "placement"> & {
  /** One-line audit notice for accountable changes, e.g. "Recorded in custody history with your name and time." */
  auditNotice?: ReactNode;
};

/**
 * Record actions and accountable state changes. Right side on desktop, bottom
 * sheet on phones. Contract: COMPONENTS.md#sheet
 */
export function Sheet({ auditNotice, footer, ...rest }: SheetProps) {
  return (
    <ModalFrame
      {...rest}
      placement="side"
      footer={
        footer || auditNotice ? (
          <div className="flex w-full flex-col gap-2">
            {auditNotice ? <p className="text-caption text-fg-muted">{auditNotice}</p> : null}
            {footer ? <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div> : null}
          </div>
        ) : undefined
      }
    />
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Names the action and the record: "Retire Unit 105?" */
  title: string;
  /** States the impact in plain words. */
  impact: ReactNode;
  /** Names the effect: "Retire vehicle". Never "OK" or "Yes". */
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  error?: ReactNode;
  /** For irreversible actions only: the person types this text to enable confirm. */
  typedConfirmation?: string;
};

/**
 * For destructive or broad-impact actions only (blueprint §1b). Routine saves,
 * creates and accountable state changes never use it. Contract: COMPONENTS.md#confirmdialog
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  impact,
  confirmLabel,
  destructive = false,
  busy = false,
  error,
  typedConfirmation,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const typedId = useId();
  const typedOk = !typedConfirmation || typed.trim() === typedConfirmation;

  return (
    <Dialog
      open={open}
      onClose={() => {
        setTyped("");
        onClose();
      }}
      title={title}
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={onConfirm}
            disabled={!typedOk}
            busy={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-body text-fg-secondary">
        <div>{impact}</div>
        {typedConfirmation ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={typedId} className="text-label text-fg-secondary">
              Type <span className="font-mono text-fg">{typedConfirmation}</span> to confirm
            </label>
            <input
              id={typedId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="tp-touch-target h-10 w-full rounded-control border border-line-strong bg-surface-sunken px-3 font-mono text-body text-fg"
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
