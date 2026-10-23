import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupRecordedFixtureStorage } from './staging-acceptance-fixture-storage.mjs';
import { retryTransientS3 } from './staging-acceptance-s3-retry.mjs';

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
      if (params.Prefix.endsWith(`${agencyA}/`)) return listing(agencyA, counts.list < 4 ? [{ Key: trackedKey, VersionId: 'v1' }] : []);
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
  assert.deepEqual(counts, { list: 6, delete: 2 });
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
        return listCalls <= 2 ? listing(agencyA, [{ Key: trackedKey, VersionId: 'v1' }]) : { ...listing(agencyA), IsTruncated: true };
      }
      return listing(agencyB);
    },
    verifyOwnership: async () => {},
    deleteVersion: async () => {},
  }), error => error.code === 'FIXTURE_STORAGE_INCOMPLETE');
});
