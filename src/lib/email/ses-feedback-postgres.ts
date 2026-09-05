import type { Pool } from 'pg';
import { recipientHash, type SesFeedback, type SesFeedbackStore } from './ses-feedback';

// Server-only construction belongs at the deployment composition boundary.
// Uses the supplied trusted pool, never a connection string from a request.
export class PostgresSesFeedbackStore implements SesFeedbackStore {
  constructor(private readonly pool: Pick<Pool, 'connect' | 'query'>) {}
  async isSuppressed(email: string): Promise<boolean> {
    const result = await this.pool.query('select 1 from public.email_suppressions where recipient_hash=$1', [recipientHash(email)]);
    return result.rowCount !== 0;
  }
  async recordAcceptance(messageId: string, departmentId: string, recipients: string[]): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(messageId) || !/^[0-9a-f-]{36}$/i.test(departmentId) || !recipients.length || recipients.length > 50) throw new Error('Invalid SES acceptance metadata.');
    const hashes = [...new Set(recipients.map(recipientHash))].sort();
    const result = await this.pool.query(`insert into public.email_provider_acceptances(message_id,department_id,recipient_hashes)
      values($1,$2,$3) on conflict(message_id) do update set message_id=excluded.message_id
      where email_provider_acceptances.department_id=excluded.department_id and email_provider_acceptances.recipient_hashes=excluded.recipient_hashes
      returning message_id`, [messageId, departmentId, hashes]);
    if (result.rowCount !== 1) throw new Error('SES acceptance mapping conflict.');
  }
  async apply(event: SesFeedback): Promise<'applied' | 'duplicate'> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const acceptance = await client.query('select department_id,recipient_hashes from public.email_provider_acceptances where message_id=$1 for update', [event.messageId]);
      const record = acceptance.rows[0];
      if (!record || event.recipientHashes.some(hash => !record.recipient_hashes.includes(hash))) throw new Error('Uncorrelated feedback');
      const inserted = await client.query(`insert into public.email_provider_events(event_id,message_id,department_id,event_kind)
        values($1,$2,$3,$4) on conflict(event_id) do nothing returning event_id`, [event.eventId, event.messageId, record.department_id, event.kind]);
      if (inserted.rowCount === 0) { await client.query('commit'); return 'duplicate'; }
      if (event.kind !== 'Delivery') {
        for (const hash of event.recipientHashes) await client.query(`insert into public.email_suppressions(recipient_hash,reason,source_event_id)
          values($1,$2,$3) on conflict(recipient_hash) do update set reason=case when email_suppressions.reason='Complaint' then 'Complaint' else excluded.reason end,
          source_event_id=excluded.source_event_id,updated_at=now()`, [hash, event.kind, event.eventId]);
      }
      await client.query('commit'); return 'applied';
    } catch {
      await client.query('rollback').catch(() => {});
      throw new Error('SES feedback persistence failed; retry event processing, never resend email.');
    } finally { client.release(); }
  }
}
