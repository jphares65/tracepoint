export type CertificationReadinessStatus =
  | "current"
  | "due_soon"
  | "expired"
  | "missing";

export type CertificationReadinessMember = {
  userId: string;
  fullName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;
};

export type CertificationReadinessType = {
  id: string;
  name: string;
  category: string;
  expirationRequired: boolean;
  defaultValidDays?: number | null;
  defaultDueSoonDays: number;
};

export type CertificationReadinessRequirement = {
  certificationTypeId: string;
  isRequired: boolean;
  isActive: boolean;
  validDays?: number | null;
  dueSoonDays?: number | null;
};

export type CertificationReadinessCredential = {
  id: string;
  userId: string;
  certificationTypeId: string;
  issueDate?: string | null;
  expirationDate?: string | null;
  isActive: boolean;
};

export type CertificationReadinessRow = {
  userId: string;
  officerName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;

  certificationTypeId: string;
  certificationName: string;
  certificationCategory: string;

  status: CertificationReadinessStatus;
  isRequired: true;

  credentialId: string | null;
  issueDate: string | null;
  expirationDate: string | null;

  daysRemaining: number | null;
  effectiveValidDays: number | null;
  effectiveDueSoonDays: number;

  statusReason: string;
};

export type CertificationReadinessSummary = {
  totalRequiredChecks: number;
  current: number;
  dueSoon: number;
  expired: number;
  missing: number;
  ready: number;
  notReady: number;
  readinessPercent: number;
};

function startOfTodayUtc() {
  const now = new Date();

  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
}

function parseDateUtc(value?: string | null) {
  if (!value) return null;

  const parsed = Date.parse(`${value}T00:00:00Z`);

  return Number.isFinite(parsed) ? parsed : null;
}

function addDaysUtc(
  dateValue: string,
  days: number,
) {
  const timestamp = parseDateUtc(dateValue);

  if (timestamp === null) return null;

  return timestamp + days * 86400000;
}

function isoDateFromUtc(timestamp: number | null) {
  if (timestamp === null) return null;

  return new Date(timestamp)
    .toISOString()
    .slice(0, 10);
}

function daysFromToday(timestamp: number | null) {
  if (timestamp === null) return null;

  return Math.ceil(
    (timestamp - startOfTodayUtc()) / 86400000,
  );
}

function effectiveExpirationTimestamp(
  credential: CertificationReadinessCredential,
  effectiveValidDays: number | null,
) {
  const explicitExpiration = parseDateUtc(
    credential.expirationDate,
  );

  if (explicitExpiration !== null) {
    return explicitExpiration;
  }

  if (
    effectiveValidDays !== null &&
    credential.issueDate
  ) {
    return addDaysUtc(
      credential.issueDate,
      effectiveValidDays,
    );
  }

  return null;
}

function compareCredentials(
  left: CertificationReadinessCredential,
  right: CertificationReadinessCredential,
  effectiveValidDays: number | null,
) {
  const leftExpiration =
    effectiveExpirationTimestamp(
      left,
      effectiveValidDays,
    );

  const rightExpiration =
    effectiveExpirationTimestamp(
      right,
      effectiveValidDays,
    );

  if (
    leftExpiration !== null ||
    rightExpiration !== null
  ) {
    return (
      (rightExpiration ?? Number.MAX_SAFE_INTEGER) -
      (leftExpiration ?? Number.MAX_SAFE_INTEGER)
    );
  }

  const leftIssue =
    parseDateUtc(left.issueDate) ?? 0;
  const rightIssue =
    parseDateUtc(right.issueDate) ?? 0;

  return rightIssue - leftIssue;
}

export function evaluateCertificationReadiness(params: {
  members: CertificationReadinessMember[];
  certificationTypes: CertificationReadinessType[];
  requirements: CertificationReadinessRequirement[];
  credentials: CertificationReadinessCredential[];
}) {
  const {
    members,
    certificationTypes,
    requirements,
    credentials,
  } = params;

  const typesById = new Map(
    certificationTypes.map((type) => [
      type.id,
      type,
    ]),
  );

  const requiredRules = requirements.filter(
    (requirement) =>
      requirement.isActive &&
      requirement.isRequired,
  );

  const credentialsByMemberAndType = new Map<
    string,
    CertificationReadinessCredential[]
  >();

  for (const credential of credentials) {
    if (
      !credential.isActive ||
      !credential.certificationTypeId
    ) {
      continue;
    }

    const key = `${credential.userId}:${credential.certificationTypeId}`;

    const existing =
      credentialsByMemberAndType.get(key) ?? [];

    existing.push(credential);

    credentialsByMemberAndType.set(
      key,
      existing,
    );
  }

  const rows: CertificationReadinessRow[] = [];

  for (const member of members) {
    for (const requirement of requiredRules) {
      const type = typesById.get(
        requirement.certificationTypeId,
      );

      if (!type) continue;

      const effectiveValidDays =
        requirement.validDays ??
        type.defaultValidDays ??
        null;

      const effectiveDueSoonDays =
        requirement.dueSoonDays ??
        type.defaultDueSoonDays;

      const key = `${member.userId}:${type.id}`;

      const matchingCredentials = [
        ...(credentialsByMemberAndType.get(key) ??
          []),
      ].sort((left, right) =>
        compareCredentials(
          left,
          right,
          effectiveValidDays,
        ),
      );

      if (matchingCredentials.length === 0) {
        rows.push({
          userId: member.userId,
          officerName: member.fullName,
          badgeNumber:
            member.badgeNumber ?? null,
          rankTitle: member.rankTitle ?? null,

          certificationTypeId: type.id,
          certificationName: type.name,
          certificationCategory: type.category,

          status: "missing",
          isRequired: true,

          credentialId: null,
          issueDate: null,
          expirationDate: null,

          daysRemaining: null,
          effectiveValidDays,
          effectiveDueSoonDays,

          statusReason:
            "No active certification record is recorded.",
        });

        continue;
      }

      let bestRow:
        | CertificationReadinessRow
        | null = null;

      for (const credential of matchingCredentials) {
        const expirationTimestamp =
          effectiveExpirationTimestamp(
            credential,
            effectiveValidDays,
          );

        /*
         * If the credential type does not require
         * expiration and no effective expiration can be
         * derived, the credential remains current.
         */
        if (
          expirationTimestamp === null &&
          !type.expirationRequired
        ) {
          bestRow = {
            userId: member.userId,
            officerName: member.fullName,
            badgeNumber:
              member.badgeNumber ?? null,
            rankTitle:
              member.rankTitle ?? null,

            certificationTypeId: type.id,
            certificationName: type.name,
            certificationCategory:
              type.category,

            status: "current",
            isRequired: true,

            credentialId: credential.id,
            issueDate:
              credential.issueDate ?? null,
            expirationDate: null,

            daysRemaining: null,
            effectiveValidDays,
            effectiveDueSoonDays,

            statusReason:
              "Active certification does not require expiration.",
          };

          break;
        }

        /*
         * Expiration is required, but neither an explicit
         * expiration nor an issue-date-derived expiration
         * is available. Treat the held credential as
         * noncompliant rather than silently current.
         */
        if (expirationTimestamp === null) {
          bestRow = {
            userId: member.userId,
            officerName: member.fullName,
            badgeNumber:
              member.badgeNumber ?? null,
            rankTitle:
              member.rankTitle ?? null,

            certificationTypeId: type.id,
            certificationName: type.name,
            certificationCategory:
              type.category,

            status: "expired",
            isRequired: true,

            credentialId: credential.id,
            issueDate:
              credential.issueDate ?? null,
            expirationDate: null,

            daysRemaining: null,
            effectiveValidDays,
            effectiveDueSoonDays,

            statusReason:
              "Certification requires an expiration date, but no valid expiration can be determined.",
          };

          continue;
        }

        const remaining =
          daysFromToday(expirationTimestamp);

        if (remaining === null) continue;

        const effectiveExpirationDate =
          isoDateFromUtc(expirationTimestamp);

        if (remaining < 0) {
          if (!bestRow) {
            bestRow = {
              userId: member.userId,
              officerName: member.fullName,
              badgeNumber:
                member.badgeNumber ?? null,
              rankTitle:
                member.rankTitle ?? null,

              certificationTypeId: type.id,
              certificationName: type.name,
              certificationCategory:
                type.category,

              status: "expired",
              isRequired: true,

              credentialId: credential.id,
              issueDate:
                credential.issueDate ?? null,
              expirationDate:
                effectiveExpirationDate,

              daysRemaining: remaining,
              effectiveValidDays,
              effectiveDueSoonDays,

              statusReason: `Certification expired ${Math.abs(
                remaining,
              )} day${
                Math.abs(remaining) === 1
                  ? ""
                  : "s"
              } ago.`,
            };
          }

          continue;
        }

        if (
          remaining <= effectiveDueSoonDays
        ) {
          bestRow = {
            userId: member.userId,
            officerName: member.fullName,
            badgeNumber:
              member.badgeNumber ?? null,
            rankTitle:
              member.rankTitle ?? null,

            certificationTypeId: type.id,
            certificationName: type.name,
            certificationCategory:
              type.category,

            status: "due_soon",
            isRequired: true,

            credentialId: credential.id,
            issueDate:
              credential.issueDate ?? null,
            expirationDate:
              effectiveExpirationDate,

            daysRemaining: remaining,
            effectiveValidDays,
            effectiveDueSoonDays,

            statusReason:
              remaining === 0
                ? "Certification expires today."
                : `Certification expires in ${remaining} days.`,
          };

          break;
        }

        bestRow = {
          userId: member.userId,
          officerName: member.fullName,
          badgeNumber:
            member.badgeNumber ?? null,
          rankTitle: member.rankTitle ?? null,

          certificationTypeId: type.id,
          certificationName: type.name,
          certificationCategory:
            type.category,

          status: "current",
          isRequired: true,

          credentialId: credential.id,
          issueDate:
            credential.issueDate ?? null,
          expirationDate:
            effectiveExpirationDate,

          daysRemaining: remaining,
          effectiveValidDays,
          effectiveDueSoonDays,

          statusReason: `Certification is current with ${remaining} days remaining.`,
        };

        break;
      }

      rows.push(
        bestRow ?? {
          userId: member.userId,
          officerName: member.fullName,
          badgeNumber:
            member.badgeNumber ?? null,
          rankTitle: member.rankTitle ?? null,

          certificationTypeId: type.id,
          certificationName: type.name,
          certificationCategory: type.category,

          status: "missing",
          isRequired: true,

          credentialId: null,
          issueDate: null,
          expirationDate: null,

          daysRemaining: null,
          effectiveValidDays,
          effectiveDueSoonDays,

          statusReason:
            "No usable certification record is available.",
        },
      );
    }
  }

  return rows;
}

export function summarizeCertificationReadiness(
  rows: CertificationReadinessRow[],
): CertificationReadinessSummary {
  const current = rows.filter(
    (row) => row.status === "current",
  ).length;

  const dueSoon = rows.filter(
    (row) => row.status === "due_soon",
  ).length;

  const expired = rows.filter(
    (row) => row.status === "expired",
  ).length;

  const missing = rows.filter(
    (row) => row.status === "missing",
  ).length;

  /*
   * Due-soon credentials remain technically ready.
   * Expired and missing credentials are not ready.
   */
  const ready = current + dueSoon;
  const notReady = expired + missing;
  const totalRequiredChecks = rows.length;

  const readinessPercent =
    totalRequiredChecks === 0
      ? 100
      : Math.round(
          (ready / totalRequiredChecks) * 100,
        );

  return {
    totalRequiredChecks,
    current,
    dueSoon,
    expired,
    missing,
    ready,
    notReady,
    readinessPercent,
  };
}
