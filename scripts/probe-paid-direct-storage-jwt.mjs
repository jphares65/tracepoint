#!/usr/bin/env node
// Exact-project synthetic authenticated Storage test. Tokens and keys stay in memory.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';

const origin = 'https://reukdouvpshshvqnzsgw.supabase.co';
const email = 'tracepoint-source-rehearsal-20260925@example.invalid';
const userId = '3698d462-6367-4a3b-98ba-27d9279fe457';
const departmentId = 'acb5b501-2309-4a9e-a504-f36c08728fa9';
const otherDepartmentId = '11111111-1111-4111-8111-111111111111';
const key = process.env.TRACEPOINT_PAID_SOURCE_KEY;
assert.match(key ?? '', /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'PAID_SOURCE_KEY_REQUIRED');
delete process.env.TRACEPOINT_PAID_SOURCE_KEY;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Bf6kAAAAASUVORK5CYII=', 'base64');
const objectName = 'source-fence-authenticated-probe-20260927.png';
let stage = 'preflight';

async function request(method, path, body, bearer = key, contentType = 'application/json') {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'PAID_PROJECT_ONLY');
  return fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'content-type': contentType }) },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body });
}

async function json(method, path, body, bearer = key) {
  const response = await request(method, path, body, bearer);
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function fenceIs(expected) {
  const result = await json('POST', '/rest/v1/rpc/tracepoint_source_rehearsal_fence_status', {});
  assert.equal(result.status, 200, 'FENCE_STATUS_UNAVAILABLE');
  assert.equal(result.body?.frozen, expected, expected ? 'FENCE_NOT_ON' : 'FENCE_NOT_OFF');
}

function objectPath(department) {
  return `/storage/v1/object/department-assets/${department}/${objectName}`;
}

async function objectExists(department) {
  const result = await request('GET', `/storage/v1/object/info/department-assets/${department}/${objectName}`);
  if (result.status === 400) {
    const body = await result.json().catch(() => null);
    const code = String(body?.errorCode ?? body?.code ?? body?.error ?? 'unknown');
    console.log(JSON.stringify({ diagnostic: 'OBJECT_INFO_MISSING_RESPONSE', status: result.status,
      code: code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) }));
    if (/not.?found|nosuchkey/i.test(code)) return false;
  }
  assert.ok([200, 404].includes(result.status), `OBJECT_INFO_UNEXPECTED_STATUS_${result.status}`);
  return result.status === 200;
}

async function upload(department, token) {
  return (await request('POST', objectPath(department), image, token, 'image/png')).status;
}

async function remove(department) {
  const result = await request('DELETE', objectPath(department));
  assert.ok(result.status >= 200 && result.status < 300, 'PROBE_OBJECT_CLEANUP_FAILED');
  assert.equal(await objectExists(department), false, 'PROBE_OBJECT_REMAINS');
}

async function run() {
  await fenceIs(false);
  assert.equal(await objectExists(departmentId), false, 'PROBE_OBJECT_PREEXISTS');
  assert.equal(await objectExists(otherDepartmentId), false, 'CROSS_TENANT_PROBE_PREEXISTS');
  const generated = await json('POST', '/auth/v1/admin/generate_link', { type: 'magiclink', email });
  assert.equal(generated.status, 200, 'MAGIC_LINK_GENERATION_FAILED');
  const tokenHash = generated.body?.hashed_token;
  assert.ok(typeof tokenHash === 'string' && tokenHash.length > 20, 'MAGIC_LINK_HASH_MISSING');
  stage = 'verify_magic_link';
  const verified = await json('POST', '/auth/v1/verify', { type: 'magiclink', token_hash: tokenHash });
  assert.equal(verified.status, 200, 'MAGIC_LINK_VERIFICATION_FAILED');
  const token = verified.body?.access_token;
  assert.ok(typeof token === 'string' && token.length > 100, 'USER_TOKEN_MISSING');
  const current = await json('GET', '/auth/v1/user', undefined, token);
  assert.equal(current.status, 200, 'USER_TOKEN_NOT_ACCEPTED');
  assert.equal(current.body?.id, userId, 'SYNTHETIC_USER_MISMATCH');
  stage = 'cross_tenant_storage';
  const crossTenantStatus = await upload(otherDepartmentId, token);
  if (crossTenantStatus >= 200 && crossTenantStatus < 300) {
    await remove(otherDepartmentId);
    throw new Error('CROSS_TENANT_STORAGE_WRITE_ALLOWED');
  }
  assert.equal(await objectExists(otherDepartmentId), false, 'CROSS_TENANT_OBJECT_CREATED');
  stage = 'same_tenant_storage';
  const initialStatus = await upload(departmentId, token);
  console.log(JSON.stringify({ diagnostic: 'SAME_TENANT_UPLOAD_STATUS', status: initialStatus }));
  assert.ok(initialStatus >= 200 && initialStatus < 300, `BASELINE_UPLOAD_FAILED_${initialStatus}`);
  assert.equal(await objectExists(departmentId), true, 'BASELINE_OBJECT_MISSING');
  await remove(departmentId);
  console.log(JSON.stringify({ result: 'PAID_DIRECT_STORAGE_BASELINE_PASS',
    crossTenantStatus, sameTenantStatus: initialStatus, objectCleaned: true, valuesLogged: false }));

  const input = createInterface({ input: process.stdin, terminal: false });
  let fenced = false;
  for await (const line of input) {
    if (line.trim() === 'on' && !fenced) {
      await fenceIs(true);
      const status = await upload(departmentId, token);
      assert.ok(status >= 400, 'FENCED_STORAGE_WRITE_ALLOWED');
      assert.equal(await objectExists(departmentId), false, 'FENCED_STORAGE_OBJECT_CREATED');
      console.log(JSON.stringify({ result: 'PAID_DIRECT_STORAGE_FENCE_PASS',
        status, objectAbsent: true, valuesLogged: false }));
      fenced = true;
    } else if (line.trim() === 'off' && fenced) {
      await fenceIs(false);
      const status = await upload(departmentId, token);
      assert.ok(status >= 200 && status < 300, `RESTORED_UPLOAD_FAILED_${status}`);
      assert.equal(await objectExists(departmentId), true, 'RESTORED_OBJECT_MISSING');
      await remove(departmentId);
      console.log(JSON.stringify({ result: 'PAID_DIRECT_STORAGE_RESTORE_PASS',
        status, objectCleaned: true, valuesLogged: false }));
      input.close();
      process.stdin.pause();
      return;
    } else {
      throw new Error('UNEXPECTED_PROBE_COMMAND');
    }
  }
  throw new Error('PROBE_INPUT_CLOSED_BEFORE_RESTORE');
}

run().catch(error => {
  const code = String(error?.message ?? 'UNKNOWN');
  console.error(/^[A-Z_]+(?:\d{3})?$/.test(code) ? code :
    JSON.stringify({ code: 'PAID_STORAGE_PROBE_FAILED', errorType: error?.name ?? 'unknown',
      stage, causeCode: String(error?.cause?.code ?? 'unknown').replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) }));
  process.exitCode = 1;
});
