import type { Pool } from 'pg';
import type { IdentityMappingStore } from './provider-core';
export class PostgresIdentityMappingStore implements IdentityMappingStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}
  async findActive(issuer: string, subject: string): Promise<{ userId: string } | null> {
    const result = await this.pool.query(`select tracepoint_user_id from public.authentication_identity_links
      where provider='cognito' and issuer=$1 and subject=$2 and state='active'`, [issuer, subject]);
    return result.rowCount === 1 ? { userId: result.rows[0].tracepoint_user_id } : null;
  }
}

// Used only by the isolated initial PKCE callback. Ordinary access/refresh
// validation continues to require an active link. The session store repeats
// every eligibility check and promotes inside its access-session transaction.
export class RehearsalInitialIdentityMappingStore implements IdentityMappingStore {
  constructor(private readonly active: IdentityMappingStore, private readonly pool: Pick<Pool, 'query'>) {}
  async findActive(issuer: string, subject: string): Promise<{ userId: string } | null> {
    const existing = await this.active.findActive(issuer, subject);
    if (existing) return existing;
    if (issuer !== 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wZwXHpznS' ||
        subject !== '445834f8-2071-7015-690e-20674d04f5c3') return null;
    const pending = await this.pool.query(`select tracepoint_user_id from public.authentication_identity_links
      where provider='cognito' and issuer=$1 and subject=$2 and state='pending'
        and tracepoint_user_id='b3848045-a73a-4f81-8a0e-cbd92abcd1be'`, [issuer, subject]);
    return pending.rowCount === 1 ? { userId: pending.rows[0].tracepoint_user_id } : null;
  }
}
