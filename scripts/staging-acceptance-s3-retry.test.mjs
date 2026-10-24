import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { cleanupRecordedFixtureStorage } from './staging-acceptance-fixture-storage.mjs';
import { boundedS3ClientConfig, retryTransientS3, transientS3FailureCode } from './staging-acceptance-s3-retry.mjs';

const agencyA = '11111111-1111-4111-8111-111111111111';
const agencyB = '22222222-2222-4222-8222-222222222222';
const trackedKey = `department-assets/${agencyA}/patch-1.png`;
const manifest = { agencies: [{ id: agencyA }, { id: agencyB }], storageObjects: [trackedKey] };
const target = { Bucket: 'staging-fixtures', ExpectedBucketOwner: '559054714699' };
const listing = (agencyId, versions = []) => ({
  Prefix: `department-assets/${agencyId}/`, IsTruncated: false, Versions: versions, DeleteMarkers: [],
});
const retryWithoutDelay = operation => retryTransientS3(operation, { baseDelayMs: 0, maxDelayMs: 0, random: () => 0, sleep: async () => {} });

test('retries transient listing, exact-version deletion, and post-delete verification', async () => {
  const counts = { list: 0, delete: 0 };
  let verified = false;
  const result = await cleanupRecordedFixtureStorage(manifest, target, {
    retry: retryWithoutDelay,
    listVersions: async params => {
      assert.equal(params.Bucket, target.Bucket);
      assert.equal(params.ExpectedBucketOwner, target.ExpectedBucketOwner);
      counts.list += 1;
      if (counts.list === 1) throw Object.assign(new Error('temporary transport failure'), { code: 'ECONNABORTED' });
      if (counts.list === 4) throw Object.assign(new Error('temporary service failure'), { $metadata: { httpStatusCode: 503 } });
      if (params.Prefix.endsWith(`${agencyA}/`)) return listing(agencyA, counts.delete < 2 ? [{ Key: trackedKey, VersionId: 'v1' }] : []);
      return listing(agencyB);
    },
    verifyOwnership: async () => { verified = true; },
    deleteVersion: async params => {
      assert.equal(verified, true);
      assert.deepEqual(params, { ...target, Key: trackedKey, VersionId: 'v1' });
      counts.delete += 1;
      if (counts.delete === 1) throw Object.assign(new Error('temporary connection reset'), { code: 'ECONNRESET' });
    },
  });
  assert.deepEqual(result, { planned: 1, deleted: 1 });
  // plan (1 retried + 2), re-plan after verify (1 retried + 2), post-delete check (2)
  assert.deepEqual(counts, { list: 8, delete: 2 });
});

// Run 4c66f928: the ownership check blocked the runner for minutes between the first listing and the delete.
const changingListing = (before, after) => {
  let verified = false;
  return {
    retry: retryWithoutDelay,
    listVersions: async params => params.Prefix.endsWith(`${agencyA}/`) ? listing(agencyA, verified ? after : before) : listing(agencyB),
    verifyOwnership: async () => { verified = true; },
  };
};

test('the deletion set is planned again after the ownership check: a version added meanwhile is deleted too', async () => {
  const deleted = [];
  let gone = false;
  const ops = changingListing([{ Key: trackedKey, VersionId: 'v1' }], [{ Key: trackedKey, VersionId: 'v1' }, { Key: trackedKey, VersionId: 'v2' }]);
  const listVersions = ops.listVersions;
  const result = await cleanupRecordedFixtureStorage(manifest, target, {
    ...ops,
    listVersions: async params => gone && params.Prefix.endsWith(`${agencyA}/`) ? listing(agencyA) : listVersions(params),
    deleteVersion: async params => { deleted.push(params.VersionId); if (deleted.length === 2) gone = true; },
  });
  assert.deepEqual(deleted, ['v1', 'v2']);
  assert.deepEqual(result, { planned: 2, deleted: 2 });
});

test('an untracked object that appears during the ownership check refuses cleanup before any deletion', async () => {
  const untracked = `department-assets/${agencyA}/patch-2.png`;
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, {
    ...changingListing([{ Key: trackedKey, VersionId: 'v1' }], [{ Key: trackedKey, VersionId: 'v1' }, { Key: untracked, VersionId: 'u1' }]),
    deleteVersion: async () => assert.fail('nothing may be deleted'),
  }), { code: 'FIXTURE_STORAGE_REFUSED' });
});

test('an object already removed by the time ownership is confirmed is not deleted again', async () => {
  const result = await cleanupRecordedFixtureStorage(manifest, target, {
    ...changingListing([{ Key: trackedKey, VersionId: 'v1' }], []),
    deleteVersion: async () => assert.fail('nothing is left to delete'),
  });
  assert.deepEqual(result, { planned: 0, deleted: 0 });
});

test('stops after bounded retries when an S3 listing keeps failing transiently', async () => {
  let calls = 0;
  let verified = false;
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, {
    retry: retryWithoutDelay,
    listVersions: async () => { calls += 1; throw Object.assign(new Error('offline'), { code: 'ETIMEDOUT' }); },
    verifyOwnership: async () => { verified = true; },
    deleteVersion: async () => assert.fail('must not delete after a failed listing'),
  }), error => error.code === 'ETIMEDOUT' && error.s3RetryAttempts === 3);
  assert.equal(calls, 3);
  assert.equal(verified, false);
});

test('does not retry permanent S3 access-denied failures', async () => {
  let calls = 0;
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, {
    retry: retryWithoutDelay,
    listVersions: async () => { calls += 1; throw Object.assign(new Error('denied'), { name: 'AccessDenied' }); },
    verifyOwnership: async () => assert.fail('ownership should not run'),
    deleteVersion: async () => assert.fail('must not delete'),
  }), error => error.name === 'AccessDenied');
  assert.equal(calls, 1);
});

test('partial cleanup can be recovered from current versions without repeating or widening deletion', async () => {
  let remaining = ['v1', 'v2'];
  let interrupted = true;
  const deleted = [];
  const common = {
    retry: retryWithoutDelay,
    listVersions: async params => params.Prefix.endsWith(`${agencyA}/`)
      ? listing(agencyA, remaining.map(VersionId => ({ Key: trackedKey, VersionId })))
      : listing(agencyB),
    verifyOwnership: async () => {},
    deleteVersion: async params => {
      assert.equal(params.Bucket, target.Bucket);
      assert.equal(params.ExpectedBucketOwner, target.ExpectedBucketOwner);
      assert.equal(params.Key, trackedKey);
      deleted.push(params.VersionId);
      if (interrupted && params.VersionId === 'v2') {
        interrupted = false;
        throw Object.assign(new Error('interrupted after one version'), { code: 'EACCES' });
      }
      remaining = remaining.filter(version => version !== params.VersionId);
    },
  };
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, common), error => error.code === 'EACCES');
  const recovery = await cleanupRecordedFixtureStorage(manifest, target, common);
  assert.deepEqual(recovery, { planned: 1, deleted: 1 });
  assert.deepEqual(deleted, ['v1', 'v2', 'v2']);
  assert.deepEqual(remaining, []);
});

test('fixture ownership verification failure preserves fail-closed deletion behavior', async () => {
  let deleteCalls = 0;
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, {
    retry: retryWithoutDelay,
    listVersions: async params => params.Prefix.endsWith(`${agencyA}/`)
      ? listing(agencyA, [{ Key: trackedKey, VersionId: 'v1' }]) : listing(agencyB),
    verifyOwnership: async () => { throw Object.assign(new Error('ownership mismatch'), { code: 'FIXTURE_OWNERSHIP_MISMATCH' }); },
    deleteVersion: async () => { deleteCalls += 1; },
  }), error => error.code === 'FIXTURE_OWNERSHIP_MISMATCH');
  assert.equal(deleteCalls, 0);
});

test('rejects a remaining tracked version after bounded verification listing completes', async () => {
  let lists = 0;
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, {
    retry: retryWithoutDelay,
    listVersions: async params => {
      lists += 1;
      if (params.Prefix.endsWith(`${agencyA}/`)) return listing(agencyA, lists > 2 ? [{ Key: trackedKey, VersionId: 'v1' }] : [{ Key: trackedKey, VersionId: 'v1' }]);
      return listing(agencyB);
    },
    verifyOwnership: async () => {},
    deleteVersion: async () => {},
  }), error => error.code === 'FIXTURE_STORAGE_INCOMPLETE');
});

test('refuses cleanup when post-deletion verification cannot inspect a complete version listing', async () => {
  let listCalls = 0;
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, {
    retry: retryWithoutDelay,
    listVersions: async params => {
      listCalls += 1;
      if (params.Prefix.endsWith(`${agencyA}/`)) {
        // calls 1 and 3 are the plan and the re-plan after the ownership check; call 5 is the post-delete check
        return listCalls <= 4 ? listing(agencyA, [{ Key: trackedKey, VersionId: 'v1' }]) : { ...listing(agencyA), IsTruncated: true };
      }
      return listing(agencyB);
    },
    verifyOwnership: async () => {},
    deleteVersion: async () => {},
  }), error => error.code === 'FIXTURE_STORAGE_INCOMPLETE');
});

// A delete can succeed on S3 while its response is lost (run 4c66f928: ECONNABORTED on a reused socket).
const lostResponse = (versionsAfterFailure, { listingFails = false } = {}) => {
  let deleteFailed = false;
  const prefixes = [];
  return {
    prefixes,
    ops: {
      retry: retryWithoutDelay,
      listVersions: async params => {
        prefixes.push(params.Prefix);
        if (params.Prefix === trackedKey && listingFails) throw Object.assign(new Error('still offline'), { code: 'ECONNABORTED' });
        if (params.Prefix === trackedKey) return { ...listing(agencyA, versionsAfterFailure), Prefix: trackedKey };
        if (params.Prefix.endsWith(`${agencyA}/`)) return listing(agencyA, deleteFailed ? versionsAfterFailure : [{ Key: trackedKey, VersionId: 'v1' }]);
        return listing(agencyB);
      },
      verifyOwnership: async () => {},
      deleteVersion: async () => { deleteFailed = true; throw Object.assign(new Error('response lost'), { code: 'ECONNABORTED' }); },
    },
  };
};

test('a delete whose response was lost counts as deleted only when an exact-version listing shows it gone', async () => {
  const { ops, prefixes } = lostResponse([]);
  assert.deepEqual(await cleanupRecordedFixtureStorage(manifest, target, ops), { planned: 1, deleted: 1 });
  assert.equal(prefixes.filter(prefix => prefix === trackedKey).length, 1);
});

test('a delete whose response was lost is still an error when the exact version is listed', async () => {
  const { ops } = lostResponse([{ Key: trackedKey, VersionId: 'v1' }]);
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, ops), error => error.code === 'ECONNABORTED' && error.s3RetryAttempts === 3);
});

test('another version of the same key does not count as the deleted version', async () => {
  const { ops } = lostResponse([{ Key: `${trackedKey}.bak`, VersionId: 'v1' }, { Key: trackedKey, VersionId: 'v1' }]);
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, ops), error => error.code === 'ECONNABORTED');
});

test('a failed confirmation listing keeps the delete error and is itself bounded', async () => {
  const { ops, prefixes } = lostResponse([], { listingFails: true });
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, ops), error => error.code === 'ECONNABORTED' && error.message === 'response lost');
  assert.equal(prefixes.filter(prefix => prefix === trackedKey).length, 3);
});

test('a confirmation listing for a different prefix is not trusted', async () => {
  const { ops } = lostResponse([]);
  const listVersions = ops.listVersions;
  ops.listVersions = async params => params.Prefix === trackedKey ? listing(agencyA) : listVersions(params);
  await assert.rejects(cleanupRecordedFixtureStorage(manifest, target, ops), error => error.message === 'response lost');
});

test('the post-delete listing is retried when it fails transiently', async () => {
  let lists = 0;
  let deleted = false;
  const result = await cleanupRecordedFixtureStorage(manifest, target, {
    retry: retryWithoutDelay,
    listVersions: async params => {
      if (!params.Prefix.endsWith(`${agencyA}/`)) return listing(agencyB);
      lists += 1;
      if (deleted && lists === 3) throw Object.assign(new Error('stale socket'), { code: 'ECONNABORTED' });
      return listing(agencyA, deleted ? [] : [{ Key: trackedKey, VersionId: 'v1' }]);
    },
    verifyOwnership: async () => {},
    deleteVersion: async () => { deleted = true; },
  });
  assert.deepEqual(result, { planned: 1, deleted: 1 });
  assert.equal(lists, 4);
});

test('network failures are classified by code, name or Code and the client is time-bounded', async () => {
  for (const error of [{ code: 'ECONNREFUSED' }, { code: 'ENOTFOUND' }, { code: 'EAI_AGAIN' }, { code: 'EHOSTUNREACH' },
    { code: 'ENETUNREACH' }, { name: 'NetworkingError' }, { name: 'Error', code: 'ECONNABORTED' }, { name: 'TimeoutError', code: 'ETIMEDOUT' }]) {
    assert.ok(transientS3FailureCode(error), JSON.stringify(error));
  }
  for (const error of [{ name: 'AccessDenied' }, { name: 'NoSuchBucket' }, { $metadata: { httpStatusCode: 403 } }]) {
    assert.equal(transientS3FailureCode(error), undefined, JSON.stringify(error));
  }
  assert.equal(boundedS3ClientConfig.maxAttempts, 1);
  assert.deepEqual(boundedS3ClientConfig.requestHandler, { connectionTimeout: 5_000, requestTimeout: 30_000, throwOnRequestTimeout: true });
});

test('the real S3 client fails a hung request instead of waiting on it, and the failure is retryable', async () => {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); }); // accepts and never answers
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new S3Client({
    ...boundedS3ClientConfig,
    requestHandler: { ...boundedS3ClientConfig.requestHandler, requestTimeout: 300 },
    region: 'us-east-1', endpoint: `http://127.0.0.1:${server.address().port}`, forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  let attempts = 0;
  try {
    await assert.rejects(retryWithoutDelay(() => { attempts += 1; return client.send(new ListObjectVersionsCommand({ Bucket: 'b', Prefix: 'p/' })); }),
      error => transientS3FailureCode(error) !== undefined && error.s3RetryAttempts === 3);
    assert.equal(attempts, 3);
  } finally {
    client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
