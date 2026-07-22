export const TRACEPOINT_PERMISSIONS = [
  "view_command_dashboard",
  "view_analytics",
  "manage_users",
  "manage_firearms",
  "manage_inspections",
  "manage_range_days",
  "score_range_days",
  "manage_qualifications",
  "submit_off_duty_requests",
  "review_off_duty_requests",
  "view_audit_log",
  "administer_department",
] as const;

export type TracePointPermission =
  (typeof TRACEPOINT_PERMISSIONS)[number];

export type PermissionRequirement = {
  anyOf?: readonly TracePointPermission[];
  allOf?: readonly TracePointPermission[];
};

type RoutePermissionRule = {
  prefix: string;
  requirement: PermissionRequirement;
};

/*
 * Specific routes intentionally come before broad routes. The lookup function
 * also sorts by prefix length so a future broad rule cannot shadow a narrower
 * workflow.
 *
 * /firearms itself remains available to authenticated members because the
 * server API limits ordinary officers to their own assigned firearm records.
 * High-risk write operations are enforced separately by the API and RLS.
 */
const ROUTE_PERMISSION_RULES: readonly RoutePermissionRule[] = [
  {
    prefix: "/firearms/ammunition/reconciliation",
    requirement: {
      anyOf: [
        "manage_firearms",
        "view_command_dashboard",
        "administer_department",
      ],
    },
  },
  {
    prefix: "/firearms/ammunition",
    requirement: {
      anyOf: [
        "manage_firearms",
        "view_command_dashboard",
        "administer_department",
      ],
    },
  },
  {
    prefix: "/firearms/inspections",
    requirement: {
      anyOf: [
        "manage_inspections",
        "manage_firearms",
        "view_command_dashboard",
        "administer_department",
      ],
    },
  },
  {
    prefix: "/command-dashboard",
    requirement: {
      anyOf: ["view_command_dashboard", "administer_department"],
    },
  },
  {
    prefix: "/analytics",
    requirement: {
      anyOf: ["view_analytics", "administer_department"],
    },
  },
  {
    prefix: "/training-alerts",
    requirement: {
      anyOf: [
        "view_analytics",
        "manage_qualifications",
        "score_range_days",
        "view_command_dashboard",
        "administer_department",
      ],
    },
  },
  {
    prefix: "/range-days",
    requirement: {
      anyOf: [
        "manage_range_days",
        "score_range_days",
        "view_command_dashboard",
        "administer_department",
      ],
    },
  },
  {
    prefix: "/qualifications",
    requirement: {
      anyOf: [
        "manage_qualifications",
        "score_range_days",
        "view_analytics",
        "administer_department",
      ],
    },
  },
  {
    prefix: "/off-duty-firearms",
    requirement: {
      anyOf: [
        "submit_off_duty_requests",
        "review_off_duty_requests",
        "administer_department",
      ],
    },
  },
  {
    prefix: "/settings",
    requirement: {
      anyOf: ["manage_users", "administer_department"],
    },
  },
];

export function isTracePointPermission(
  value: unknown,
): value is TracePointPermission {
  return (
    typeof value === "string" &&
    (TRACEPOINT_PERMISSIONS as readonly string[]).includes(value)
  );
}

export function meetsPermissionRequirement(
  permissions: Iterable<TracePointPermission>,
  requirement?: PermissionRequirement,
) {
  if (!requirement) return true;

  const permissionSet = new Set(permissions);

  if (permissionSet.has("administer_department")) {
    return true;
  }

  const satisfiesAll =
    !requirement.allOf ||
    requirement.allOf.every((permission) =>
      permissionSet.has(permission),
    );

  const satisfiesAny =
    !requirement.anyOf ||
    requirement.anyOf.length === 0 ||
    requirement.anyOf.some((permission) =>
      permissionSet.has(permission),
    );

  return satisfiesAll && satisfiesAny;
}

export function getRoutePermissionRequirement(
  pathname: string,
): PermissionRequirement | undefined {
  const normalizedPath = pathname.toLowerCase();

  const rule = [...ROUTE_PERMISSION_RULES]
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(({ prefix }) => {
      const normalizedPrefix = prefix.toLowerCase();

      return (
        normalizedPath === normalizedPrefix ||
        normalizedPath.startsWith(`${normalizedPrefix}/`)
      );
    });

  return rule?.requirement;
}
