// PostgreSQL accepts UUID text with optional braces and optional hyphens. Normalize
// that database-approved representation before it becomes request authorization
// context, while rejecting every non-UUID value.
const postgresUuid = /^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i;

export function normalizePostgresUuid(value: string): string | null {
  const match = postgresUuid.exec(value);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`.toLowerCase();
}
