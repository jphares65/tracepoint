// Bridge (Supabase) invite: the auth user list is read page by page until the
// last page, so an existing account is found however many users the platform has.
export async function findAuthUserByEmail<T extends { email?: string | null }>(
  listPage: (page: number, perPage: number) => Promise<{ data: { users: T[] } | null; error: unknown }>,
  email: string,
  perPage = 100,
) {
  const target = email.toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await listPage(page, perPage);
    if (error) throw error;
    const users = data?.users ?? [];
    const match = users.find((user) => user.email?.toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) return null;
  }
}

// Inviting someone who is already a member of the agency changes nothing:
// it does not overwrite their details or reactivate a deactivated member.
export const EXISTING_MEMBER_INVITE = {
  status: 409,
  error: "This person is already a member of this agency. Nothing was changed. Use Edit Access to update them or Send Activation to resend their invitation.",
} as const;

// Refusals raised by tracepoint_auth.prepare_cognito_invite, mapped to the
// route's existing messages. Anything else is reported without its detail.
const COGNITO_INVITE_REFUSALS: Record<string, { status: number; error: string }> = {
  "explicit existing identity selection required": {
    status: 409,
    error: "A TracePoint account already exists for this email address. Nothing was changed. Update an existing member with Edit Access, or add a person from another agency through personnel import.",
  },
  "administrator assignment forbidden": { status: 403, error: "Only a department Administrator may assign the Administrator role." },
  "invite forbidden": { status: 403, error: "You do not have permission to manage users." },
  "invalid roles": { status: 400, error: "One or more selected roles are invalid." },
  "invalid groups": { status: 400, error: "One or more selected groups are invalid." },
  "invite rejected": { status: 400, error: "Department, email, full name, and at least one role are required." },
};

export function cognitoInviteRefusal(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && Object.hasOwn(COGNITO_INVITE_REFUSALS, message) ? COGNITO_INVITE_REFUSALS[message] : null;
}
