import {classifyStagingLogs} from './staging-log-classification.mjs';

export function correlateHistoricalLogs(applicationEvents, wafRecords, {wafEvidenceAuthorized = true} = {}) {
  const classification = classifyStagingLogs(applicationEvents);
  const wafTimes = wafRecords.map(record => Number(record.timestamp)).filter(Number.isFinite);
  const requestActions = {};
  let requestsWithNextActionHeader = 0;
  for (const record of wafRecords) {
    const action = ['ALLOW', 'BLOCK', 'COUNT', 'CAPTCHA', 'CHALLENGE'].includes(record.action) ? record.action : 'OTHER';
    requestActions[action] = (requestActions[action] ?? 0) + 1;
    const headers = Array.isArray(record.httpRequest?.headers) ? record.httpRequest.headers : [];
    if (headers.some(header => String(header.name).toLowerCase() === 'next-action')) requestsWithNextActionHeader++;
  }
  const unknownCorrelation = applicationEvents
    .filter(event => classification.unknownFingerprints.includes(event.fingerprint))
    .map(event => ({
      fingerprint:event.fingerprint,
      nearestWafRequestMilliseconds:wafTimes.length ? Math.min(...wafTimes.map(timestamp => Math.abs(timestamp - event.timestamp))) : null,
    }));
  return {
    application:{
      total:classification.total,
      categories:classification.categories,
      unknownFingerprints:classification.unknownFingerprints,
      firstAt:classification.firstAt,
      lastAt:classification.lastAt,
    },
    waf:{authorized:wafEvidenceAuthorized, total:wafRecords.length, requestActions, requestsWithNextActionHeader},
    unknownCorrelation,
    messagesPrinted:false,
  };
}
