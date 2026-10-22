import Link from "next/link";

import { cx } from "./cx";

export type EntityLabelProps = {
  /** Human name: "Glock 17", "Unit 105", "Officer Jane Doe". */
  name: string | null | undefined;
  /** Identifier people match against a physical tag: serial, plate, asset tag, badge. Shown in mono. */
  identifier?: string | null;
  /** Secondary facts: "Handgun · 9mm". */
  meta?: string | null;
  href?: string;
  /** Shown when the name is missing. Never a raw database id. */
  fallback?: string;
  className?: string;
};

/** Names a record the way people know it, never by an internal id. Contract: COMPONENTS.md#entitylabel */
export function EntityLabel({ name, identifier, meta, href, fallback = "Unnamed record", className }: EntityLabelProps) {
  const title = name?.trim() || fallback;
  const heading = href ? (
    <Link href={href} className="font-medium text-fg hover:text-accent-text hover:underline">
      {title}
    </Link>
  ) : (
    <span className="font-medium text-fg">{title}</span>
  );
  return (
    <span className={cx("flex min-w-0 flex-col", className)}>
      <span className="truncate text-body">{heading}</span>
      {identifier || meta ? (
        <span className="truncate text-caption text-fg-muted">
          {identifier ? <span className="font-mono text-fg-secondary">{identifier}</span> : null}
          {identifier && meta ? " · " : null}
          {meta}
        </span>
      ) : null}
    </span>
  );
}
