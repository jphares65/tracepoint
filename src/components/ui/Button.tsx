import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

import { cx } from "./cx";

/**
 * Four variants and two sizes (blueprint §1 "Buttons"). One primary per view.
 * Contract: docs/modernization/design-system/COMPONENTS.md#button
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface-raised text-fg hover:border-fg-muted",
  quiet: "border border-transparent bg-transparent text-fg-secondary hover:bg-surface-raised hover:text-fg",
  destructive: "border border-danger-line bg-danger-soft text-danger hover:bg-danger hover:text-canvas",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-label",
  md: "h-10 gap-2 px-4 text-body",
};

export function buttonClassName(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(
    "tp-touch-target inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control font-semibold transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

type ButtonOwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** While true the button is disabled, announces busy and shows busyLabel. */
  busy?: boolean;
  busyLabel?: string;
};

export type ButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  busy = false,
  busyLabel,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClassName(variant, size, className)}
      {...rest}
    >
      {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : icon}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}

export type ButtonLinkProps = Pick<ButtonOwnProps, "variant" | "size" | "icon"> &
  Omit<ComponentProps<typeof Link>, "children"> & { children: ReactNode };

/** A link styled as a button. Use for navigation; use Button for actions. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName(variant, size, className)} {...rest}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
