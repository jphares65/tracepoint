export type FirearmQualificationAttempt = {
  id?: string;
  officerId: string;
  firearmId: string;
  occurredAt: string;
  passed: boolean;
};

export type FirearmQualificationLockoutPolicy = {
  enabled: boolean;
  threshold: number;
  countMode: "consecutive_since_pass";
  scope: "specific_firearm";
  restoreOnPassingRequalification: boolean;
  requireSupervisorReleaseAfterRequalification: boolean;
};

export type FirearmQualificationAuthorizationResult = {
  restricted: boolean;
  consecutiveFailures: number;
  threshold: number;
  thresholdReached: boolean;
  passingRequalificationRecorded: boolean;
  supervisorReleaseRequired: boolean;
  lastAttemptAt?: string;
  reason: string;
};

function dateValue(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Evaluates qualification authorization for one officer/firearm pair.
 *
 * This intentionally does NOT evaluate the firearm's mechanical or
 * inventory status. A serviceable firearm may remain Active while the
 * assigned officer is Qualification Restricted from using it.
 */
export function evaluateFirearmQualificationAuthorization({
  attempts,
  officerId,
  firearmId,
  policy,
  supervisorReleaseApproved = false,
}: {
  attempts: FirearmQualificationAttempt[];
  officerId: string;
  firearmId: string;
  policy: FirearmQualificationLockoutPolicy;
  supervisorReleaseApproved?: boolean;
}): FirearmQualificationAuthorizationResult {
  const threshold = Math.max(1, Number(policy.threshold) || 1);

  if (!policy.enabled) {
    return {
      restricted: false,
      consecutiveFailures: 0,
      threshold,
      thresholdReached: false,
      passingRequalificationRecorded: false,
      supervisorReleaseRequired: false,
      reason:
        "Repeated qualification failures do not suspend firearm authorization under current agency policy.",
    };
  }

  const relevantAttempts = attempts
    .filter(
      (attempt) =>
        attempt.officerId === officerId &&
        attempt.firearmId === firearmId,
    )
    .sort(
      (left, right) =>
        dateValue(left.occurredAt) - dateValue(right.occurredAt),
    );

  if (relevantAttempts.length === 0) {
    return {
      restricted: false,
      consecutiveFailures: 0,
      threshold,
      thresholdReached: false,
      passingRequalificationRecorded: false,
      supervisorReleaseRequired: false,
      reason:
        "No recorded qualification attempts were found for this officer and firearm.",
    };
  }

  let consecutiveFailures = 0;
  let restrictionTriggered = false;
  let passingRequalificationRecorded = false;

  for (const attempt of relevantAttempts) {
    if (attempt.passed) {
      if (restrictionTriggered) {
        passingRequalificationRecorded = true;

        if (
          policy.restoreOnPassingRequalification &&
          !policy.requireSupervisorReleaseAfterRequalification
        ) {
          restrictionTriggered = false;
        }

        if (
          policy.restoreOnPassingRequalification &&
          policy.requireSupervisorReleaseAfterRequalification &&
          supervisorReleaseApproved
        ) {
          restrictionTriggered = false;
        }
      }

      consecutiveFailures = 0;
      continue;
    }

    consecutiveFailures += 1;
    passingRequalificationRecorded = false;

    if (consecutiveFailures >= threshold) {
      restrictionTriggered = true;
    }
  }

  const lastAttempt =
    relevantAttempts[relevantAttempts.length - 1];

  const supervisorReleaseRequired =
    restrictionTriggered &&
    passingRequalificationRecorded &&
    policy.requireSupervisorReleaseAfterRequalification;

  if (restrictionTriggered) {
    if (supervisorReleaseRequired) {
      return {
        restricted: true,
        consecutiveFailures,
        threshold,
        thresholdReached: true,
        passingRequalificationRecorded: true,
        supervisorReleaseRequired: true,
        lastAttemptAt: lastAttempt?.occurredAt,
        reason:
          "A passing requalification has been recorded, but agency policy requires supervisor or range-master release before firearm authorization is restored.",
      };
    }

    return {
      restricted: true,
      consecutiveFailures,
      threshold,
      thresholdReached: true,
      passingRequalificationRecorded,
      supervisorReleaseRequired: false,
      lastAttemptAt: lastAttempt?.occurredAt,
      reason:
        `Officer reached the agency threshold of ${threshold} consecutive failed qualification attempt${threshold === 1 ? "" : "s"} with this firearm.`,
    };
  }

  if (passingRequalificationRecorded) {
    return {
      restricted: false,
      consecutiveFailures: 0,
      threshold,
      thresholdReached: false,
      passingRequalificationRecorded: true,
      supervisorReleaseRequired: false,
      lastAttemptAt: lastAttempt?.occurredAt,
      reason:
        "A passing requalification restored firearm authorization under current agency policy.",
    };
  }

  return {
    restricted: false,
    consecutiveFailures,
    threshold,
    thresholdReached: false,
    passingRequalificationRecorded: false,
    supervisorReleaseRequired: false,
    lastAttemptAt: lastAttempt?.occurredAt,
    reason:
      consecutiveFailures > 0
        ? `${consecutiveFailures} consecutive failed qualification attempt${consecutiveFailures === 1 ? "" : "s"} recorded; agency restriction threshold has not been reached.`
        : "Current qualification history does not require an officer/firearm restriction.",
  };
}