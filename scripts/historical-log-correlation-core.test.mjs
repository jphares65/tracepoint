import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {correlateHistoricalLogs} from './historical-log-correlation-core.mjs';

test('correlates timing and header names without retaining messages or header values', () => {
  const timestamp = Date.parse('2026-09-06T12:06:43.700Z');
  const message = 'unclassified sensitive customer text';
  const fingerprint = createHash('sha256').update(message).digest('hex');
  const report = correlateHistoricalLogs(
    [{timestamp, message, fingerprint}],
    [{timestamp:timestamp - 20, action:'ALLOW', httpRequest:{headers:[{name:'next-action', value:'sensitive'}]}}],
  );
  assert.equal(report.waf.total, 1);
  assert.equal(report.waf.authorized, true);
  assert.equal(report.waf.requestsWithNextActionHeader, 1);
  assert.deepEqual(report.unknownCorrelation, [{fingerprint, nearestWafRequestMilliseconds:20}]);
  assert.equal(report.messagesPrinted, false);
  assert.equal(JSON.stringify(report).includes('sensitive'), false);
});
test('reports an unavailable WAF correlation as unauthorized rather than empty evidence', () => {
  const report = correlateHistoricalLogs([], [], {wafEvidenceAuthorized:false});
  assert.equal(report.waf.authorized, false);
  assert.equal(report.waf.total, 0);
});
