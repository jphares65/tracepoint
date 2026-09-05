export type TracePointIdentity = {
  userId: string;
  provider: 'supabase' | 'cognito';
  issuer: string;
  subject: string;
};
export interface AuthenticationProvider { verifySession(token?: string): Promise<TracePointIdentity | null>; }
export interface IdentityMappingStore {
  findActive(issuer: string, subject: string): Promise<{ userId: string } | null>;
}
export type ActiveDepartmentMembership = { departmentId: string; permissions: string[] };
export async function resolveIdentityDepartment(identity: TracePointIdentity, departmentId: string,
  lookup: (userId: string, departmentId: string) => Promise<ActiveDepartmentMembership | null>) {
  try {
    const membership = await lookup(identity.userId, departmentId);
    return membership?.departmentId === departmentId ? membership : null;
  } catch { return null; }
}
// Lifecycle ports are deliberately separate from JWT verification. Their
// implementations must perform tenant authorization before administrative calls.
export interface AuthenticationLifecycle {
  invite(input: { userId: string; departmentId: string; email: string }): Promise<void>;
  activate(input: { challengeId: string; code: string }): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  completePasswordReset(input: { challengeId: string; code: string; password: string }): Promise<void>;
  logout(sessionId: string): Promise<void>;
}
export class SupabaseAuthenticationProvider implements AuthenticationProvider {
  constructor(private readonly issuer: string, private readonly getVerifiedUser: () => Promise<{ id: string } | null>) {}
  async verifySession(): Promise<TracePointIdentity | null> {
    try {
      const user = await this.getVerifiedUser();
      if (!user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) return null;
      return { userId: user.id, provider: 'supabase', issuer: this.issuer, subject: user.id };
    } catch { return null; }
  }
}
