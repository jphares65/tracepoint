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

// One fingerprint per alert condition (TRN-10): the entity key, kind, severity
// and condition date. Detail text such as "expires in 16 days" changes daily
// and must not reset snoozes or queue a new email.
export function notificationFingerprint(
  item: ReconciledGeneratedNotification,
) {
  return JSON.stringify({
    v: 2,
    key: item.key,
    source: item.source,
    kind: item.kind,
    title: item.title,
    priority: item.priority,
    createdAt: item.createdAt || null,
  });
}

// Rows written before v2 stored the whole alert; compare them by condition so
// the upgrade itself neither resets snoozes nor re-sends email.
function priorCondition(fingerprint: unknown) {
  const value = String(fingerprint);
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && parsed.v !== 2 && typeof parsed.key === "string") {
      return notificationFingerprint(parsed);
    }
  } catch {}
  return value;
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
  const condition = notificationFingerprint(item);
  const changed = Boolean(
    prior && priorCondition(prior.fingerprint) !== condition,
  );
  const fingerprint = prior && !changed ? String(prior.fingerprint) : condition;

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
      acknowledged_at: changed ? null : prior?.acknowledged_at ?? null,
      snoozed_until: changed ? null : prior?.snoozed_until ?? null,
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
