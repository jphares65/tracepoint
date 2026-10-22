// UX-RB2-4 (D-60, D-15): a critical safety hold, or open critical work, keeps a
// vehicle out of service (fleet-server.ts refreshFleetVehicle, database/aws/046).
// Available and Attention cannot be chosen then, and a change the server did not
// apply is never reported as done.
const HOLD_BLOCKED_STATUSES = new Set(["Available", "Attention"]);

export function statusBlockedByHold(held: boolean, status: string) {
  return held && HOLD_BLOCKED_STATUSES.has(status);
}

export function statusChangeMessage(unit: string, requested: string, resulting: string | null | undefined) {
  if (!resulting || resulting === requested) {
    return { tone: "success" as const, message: `Unit ${unit} status updated and audited.` };
  }
  return {
    tone: "warning" as const,
    message: `Unit ${unit} stays ${resulting}: a critical safety hold or open critical work keeps it out of service. Your reason was recorded. Open the vehicle to review the hold.`,
  };
}
