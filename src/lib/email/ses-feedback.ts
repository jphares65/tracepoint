import { createHash } from 'node:crypto';
import type { VerifiedNotification } from './sns-notification';

export type SesFeedback = { eventId: string; messageId: string; kind: 'Delivery' | 'Bounce' | 'Complaint'; recipientHashes: string[] };
export function recipientHash(email: string): string {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email.trim())) throw new Error('Invalid feedback recipient.');
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
// No headers, body, diagnostic strings or plaintext addresses enter persistence.
// The tenant is resolved from an accepted-message registry, never event tags.
export function parseSesFeedback(notification: VerifiedNotification, expectedAccount: string): SesFeedback {
  try {
    if (!/^\d{12}$/.test(expectedAccount) || expectedAccount === '265544358665') throw new Error();
    const event = JSON.parse(notification.message);
    const kind = event.eventType ?? event.notificationType;
    if (!['Delivery', 'Bounce', 'Complaint'].includes(kind) || event.mail?.sendingAccountId !== expectedAccount ||
      typeof event.mail.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(event.mail.messageId)) throw new Error();
    const recipients = kind === 'Delivery' ? event.delivery?.recipients :
      kind === 'Bounce' ? event.bounce?.bouncedRecipients?.map((entry: { emailAddress: string }) => entry.emailAddress) :
      event.complaint?.complainedRecipients?.map((entry: { emailAddress: string }) => entry.emailAddress);
    if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 50 || recipients.some(email => typeof email !== 'string')) throw new Error();
    const recipientHashes = [...new Set<string>(recipients.map(recipientHash))].sort();
    // Semantic ID also deduplicates the same provider event arriving under another SNS ID.
    const eventId = createHash('sha256').update(JSON.stringify([event.mail.messageId, kind, recipientHashes])).digest('hex');
    return { eventId, messageId: event.mail.messageId, kind, recipientHashes };
  } catch { throw new Error('Malformed SES feedback; contents suppressed.'); }
}

export interface SesFeedbackStore {
  // Must atomically validate the registered recipients, insert the event once,
  // and upsert suppression. Unknown acceptance IDs must fail for later retry.
  apply(event: SesFeedback): Promise<'applied' | 'duplicate'>;
  isSuppressed(email: string): Promise<boolean>;
  recordAcceptance(messageId: string, departmentId: string, recipients: string[]): Promise<void>;
}
