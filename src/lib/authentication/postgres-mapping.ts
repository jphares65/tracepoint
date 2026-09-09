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
