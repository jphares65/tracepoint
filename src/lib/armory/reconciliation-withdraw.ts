import type { TracePointPermission } from "@/lib/tracepoint/permissions";

// Owner decision: withdrawing a submitted ammunition reconciliation is a
// management action that needs a reason and an audit record. Until a dedicated
// permission exists in the catalog (a database change), it is limited to
// agency administrators.
export const RECONCILIATION_WITHDRAW_PERMISSIONS: readonly TracePointPermission[] = ["administer_department"];
