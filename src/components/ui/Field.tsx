import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cx } from "./cx";

/** Props a Field hands to its control so label, help and error are wired for assistive tech. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};

export type FieldProps = {
  label: string;
  /** Help text under the control. */
  help?: ReactNode;
  /** Inline error. When set, the control is marked invalid and the error is announced. */
  error?: ReactNode;
  required?: boolean;
  /** Supply to control the id; otherwise one is generated. */
  id?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * A visible label above, help below, an inline error. No placeholder-only inputs.
 * Contract: COMPONENTS.md#field
 */
export function Field({ label, help, error, required = false, id, className, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className="text-label font-medium text-fg-secondary">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {children({
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : null}
      {help ? (
        <p id={helpId} className="text-caption text-fg-muted">
          {help}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "tp-touch-target w-full rounded-control border border-line-strong bg-surface-sunken px-3 text-body text-fg " +
  "placeholder:text-fg-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-focus " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger";

export function controlClassName(className?: string) {
  return cx(CONTROL, className);
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClassName(cx("h-10", className))} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={controlClassName(cx("h-10 pr-8", className))} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={controlClassName(cx("min-h-24 py-2", className))} {...rest} />;
}
