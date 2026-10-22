export type ReconciledGeneratedNotification = {
  key: string;
  source: string;
  kind: string;
  title: string;
  detail: string;
  href: string;
  priority: string;
  createdAt?: string | null;
  [key: string]: unknown;
};

export type ReconciledExistingNotification = {
  notification_key?: string | null;
  fingerprint?: string | null;
  first_seen_at?: string | null;
  acknowledged_at?: string | null;
  snoozed_until?: string | null;
  resolved_at?: string | null;
  source?: string | null;
};

export function notificationFingerprint(
  item: ReconciledGeneratedNotification,
) {
  return JSON.stringify(item);
}

export function buildNotificationEventReconciliationRow({
  departmentId,
  userId,
  item,
  prior,
  now,
}: {
  departmentId: string;
  userId: string;
  item: ReconciledGeneratedNotification;
  prior?: ReconciledExistingNotification;
  now: string;
}) {
  const fingerprint = notificationFingerprint(item);
  const changed = Boolean(
    prior && String(prior.fingerprint) !== fingerprint,
  );
  // The read path upserts on (department_id,user_id,notification_key) and the
  // upsert updates only the columns it is given. For an unchanged condition the
  // officer-owned acknowledgement/snooze columns are left out, so an
  // acknowledge or snooze made while this read was in flight is never
  // overwritten with the stale value read earlier (which also kept the
  // dispatcher from mailing an item the officer had just acknowledged). A new
  // or changed condition writes them explicitly: insert defaults, or reopen.
  const officerState = prior && !changed
    ? {}
    : { acknowledged_at: null, snoozed_until: null };

  return {
    fingerprint,
    row: {
      department_id: departmentId,
      user_id: userId,
      notification_key: item.key,
      source: item.source,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      href: item.href,
      priority: item.priority,
      fingerprint,
      source_created_at: item.createdAt || null,
      first_seen_at: prior?.first_seen_at ?? now,
      last_seen_at: now,
      resolved_at: null,
      ...officerState,
      updated_at: now,
    },
  };
}

export function notificationEventShouldResolve({
  event,
  successfulSources,
  activeKeys,
}: {
  event: ReconciledExistingNotification;
  successfulSources: ReadonlySet<string>;
  activeKeys: ReadonlySet<string>;
}) {
  return Boolean(
    successfulSources.has(String(event.source))
      && !activeKeys.has(String(event.notification_key))
      && !event.resolved_at,
  );
}
