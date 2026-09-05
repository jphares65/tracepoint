import { verify, X509Certificate } from 'node:crypto';

type Envelope = Record<string, unknown>;
export type VerifiedNotification = { notificationId: string; topicArn: string; message: string };
function invalid(): never { throw new Error('SNS notification validation failed.'); }

export function notificationSigningText(value: Envelope): string {
  const fields = ['Message', 'MessageId', ...(Object.hasOwn(value, 'Subject') ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type'];
  return fields.map(field => {
    if (typeof value[field] !== 'string') invalid();
    return `${field}\n${value[field]}\n`;
  }).join('');
}

// This boundary accepts Notification only. Subscription confirmation must be
// performed by a separate reviewed operator procedure, never by following a URL.
export async function verifySnsNotification(body: string, expectedTopicArn: string,
  options: { fetch?: typeof fetch; now?: number } = {}): Promise<VerifiedNotification> {
  try {
    const topic = /^arn:(aws|aws-us-gov):sns:([a-z0-9-]+):(\d{12}):[A-Za-z0-9_-]+$/.exec(expectedTopicArn);
    if (!topic || topic[3] === '265544358665' || Buffer.byteLength(body) > 262144) invalid();
    const envelope = JSON.parse(body) as Envelope;
    if (!envelope || envelope.Type !== 'Notification' || envelope.TopicArn !== expectedTopicArn ||
      (typeof envelope.SignatureVersion !== 'string' || !['1', '2'].includes(envelope.SignatureVersion)) || typeof envelope.MessageId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(envelope.MessageId)) invalid();
    const timestamp = typeof envelope.Timestamp === 'string' ? Date.parse(envelope.Timestamp) : NaN;
    const now = options.now ?? Date.now();
    // Permit SNS delivery retries for 23 days; durable event IDs prevent replay effects.
    if (!Number.isFinite(timestamp) || timestamp > now + 300000 || timestamp < now - 23 * 86400000) invalid();
    const certUrl = new URL(String(envelope.SigningCertURL));
    if (certUrl.protocol !== 'https:' || certUrl.host !== `sns.${topic[2]}.amazonaws.com` ||
      certUrl.username || certUrl.password || certUrl.search || certUrl.hash ||
      !/^\/SimpleNotificationService-[a-zA-Z0-9_-]+\.pem$/.test(certUrl.pathname)) invalid();
    const response = await (options.fetch ?? fetch)(certUrl, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 16384 || !response.body) invalid();
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break;
      length += next.value.length; if (length > 16384) { await reader.cancel(); invalid(); } chunks.push(next.value);
    } } finally { reader.releaseLock(); }
    const certificate = new X509Certificate(Buffer.concat(chunks));
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now || certificate.publicKey.asymmetricKeyType !== 'rsa') invalid();
    if (typeof envelope.Signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.Signature)) invalid();
    if (!verify(envelope.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1', Buffer.from(notificationSigningText(envelope)),
      certificate.publicKey, Buffer.from(envelope.Signature, 'base64'))) invalid();
    return { notificationId: envelope.MessageId, topicArn: expectedTopicArn, message: envelope.Message as string };
  } catch { return invalid(); }
}
