// Scheduled per-member alert generation (TRN-01 / FLT-05). One invocation
// handles one bounded page of active members, ordered by agency then user,
// and returns the cursor for the next page. Each member is generated with the
// same code path as GET /api/notifications, so writes are idempotent upserts.
export type GenerationTarget = { departmentId: string; userId: string };
export type GenerationRequest = { departmentId: string | null; after: GenerationTarget | null; limit: number };
export type GenerationOutcome = "generated" | "skipped";
export type GenerationDependencies = {
  withRunLock<T>(run: () => Promise<T>): Promise<{ acquired: false } | { acquired: true; value: T }>;
  listTargets(request: GenerationRequest): Promise<GenerationTarget[]>;
  generate(target: GenerationTarget): Promise<GenerationOutcome>;
  onFailure?(target: GenerationTarget, error: unknown): void;
};

export const DEFAULT_GENERATION_LIMIT = 50;
export const MAX_GENERATION_LIMIT = 200;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: unknown) => typeof value === "string" && uuid.test(value.trim()) ? value.trim().toLowerCase() : null;

export function parseGenerationRequest(body: unknown):
  { ok: true; request: GenerationRequest } | { ok: false; error: string } {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const departmentId = input.departmentId === undefined || input.departmentId === null ? null : id(input.departmentId);
  if (input.departmentId !== undefined && input.departmentId !== null && !departmentId) return { ok: false, error: "departmentId must be a UUID." };
  let after: GenerationTarget | null = null;
  if (input.after !== undefined && input.after !== null) {
    const cursor = typeof input.after === "object" ? input.after as Record<string, unknown> : {};
    const afterDepartment = id(cursor.departmentId), afterUser = id(cursor.userId);
    if (!afterDepartment || !afterUser) return { ok: false, error: "after must name a departmentId and userId." };
    after = { departmentId: afterDepartment, userId: afterUser };
  }
  const limit = input.limit === undefined ? DEFAULT_GENERATION_LIMIT : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GENERATION_LIMIT) {
    return { ok: false, error: `limit must be an integer from 1 to ${MAX_GENERATION_LIMIT}.` };
  }
  return { ok: true, request: { departmentId, after, limit } };
}

export async function runNotificationGeneration(dependencies: GenerationDependencies, request: GenerationRequest) {
  const run = await dependencies.withRunLock(async () => {
    const targets = await dependencies.listTargets(request);
    let generated = 0, skipped = 0, failed = 0;
    for (const target of targets) {
      try {
        if (await dependencies.generate(target) === "generated") generated += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        dependencies.onFailure?.(target, error);
      }
    }
    const last = targets.at(-1);
    return { attempted: targets.length, generated, skipped, failed, nextCursor: last && targets.length === request.limit ? last : null };
  });
  return run.acquired ? { locked: false as const, ...run.value } : { locked: true as const };
}
