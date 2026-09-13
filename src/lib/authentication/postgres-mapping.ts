import type { Pool } from 'pg';
import type { IdentityMappingStore } from './provider-core';
export class PostgresIdentityMappingStore implements IdentityMappingStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}
  async findActive(issuer: string, subject: string): Promise<{ userId: string } | null> {
    const result = await this.pool.query(`select tracepoint_user_id from public.authentication_identity_links
      where provider='cognito' and issuer=$1 and subject=$2 and state='active'`, [issuer, subject]);
    return result.rowCount === 1 ? { userId: result.rows[0].tracepoint_user_id } : null;
  }
  async activatePendingPlatformAdministrator(issuer: string, subject: string): Promise<{ userId: string } | null> {
    const result = await this.pool.query(`with eligible as (
        select link.tracepoint_user_id
        from public.authentication_identity_links link
        join public.platform_admins administrator on administrator.user_id=link.tracepoint_user_id and administrator.is_active
        where link.provider='cognito' and link.issuer=$1 and link.subject=$2 and link.state='pending'
          and not exists(select 1 from public.department_memberships membership where membership.user_id=link.tracepoint_user_id)
        for update of link
      )
      update public.authentication_identity_links link set state='active',updated_at=clock_timestamp()
      from eligible where link.provider='cognito' and link.issuer=$1 and link.subject=$2
        and link.tracepoint_user_id=eligible.tracepoint_user_id and link.state='pending'
      returning link.tracepoint_user_id`, [issuer, subject]);
    return result.rowCount === 1 ? { userId: result.rows[0].tracepoint_user_id } : null;
  }
}
