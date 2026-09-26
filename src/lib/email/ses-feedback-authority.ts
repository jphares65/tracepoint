// Versioned worker database authorities. A mode never permits a second secret or host.
export const feedbackAuthorities = Object.freeze({
  old: Object.freeze({
    secretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/runtime-K4C4HY',
    host: 'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
    databaseId: 'tracepoint-production',
    resourceId: 'db-MGFUA4PIFH25YQOFOGWEG2GFHM',
  }),
  rehearsal: Object.freeze({
    secretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/rehearsal/database-runtime-4272874f-uDq389',
    host: 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
    databaseId: 'tracepoint-production-migration-rehearsal-4272874f-20260923',
    resourceId: 'db-WX6GX35AIJ546ZRCZIRQ545B3E',
  }),
  final: Object.freeze({
    secretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/final/database-runtime-20260926-yg23sb',
    host: 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
    databaseId: 'tracepoint-production-final-cutover-20260926',
    resourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
  }),
});

export type FeedbackAuthority = keyof typeof feedbackAuthorities;

export function resolveFeedbackAuthority(mode: string | undefined, secretArn: string, host: string) {
  if (mode !== 'old' && mode !== 'rehearsal' && mode !== 'final') {
    throw new Error('Unknown feedback database authority.');
  }
  const expected = feedbackAuthorities[mode];
  if (secretArn !== expected.secretArn || host !== expected.host) {
    throw new Error('Feedback database authority mismatch.');
  }
  return expected;
}
