import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { REQUIRED_MOBILE_ROUTES, assertMobileRouteManifest, assertMobileRouteSources } from './mobile-route-image-contract-core.mjs';

function fixture(omit = null) {
  const root = mkdtempSync(join(tmpdir(), 'tracepoint-mobile-image-contract-'));
  writeFileSync(join(root, 'app-path-routes-manifest.json'), JSON.stringify(Object.fromEntries(REQUIRED_MOBILE_ROUTES.filter((route) => route !== omit).map((route) => [`${route}/route`, route]))));
  writeFileSync(join(root, 'routes-manifest.json'), JSON.stringify({ staticRoutes: REQUIRED_MOBILE_ROUTES.filter((route) => !route.includes('[') && route !== omit).map((page) => ({ page })), dynamicRoutes: REQUIRED_MOBILE_ROUTES.filter((route) => route.includes('[') && route !== omit).map((page) => ({ page })) }));
  return root;
}

test('the image contract requires every supported mobile workflow route in both Next manifests', () => {
  const root = fixture();
  try { assert.doesNotThrow(() => assertMobileRouteManifest(root)); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('the image contract rejects a missing compiled mobile route', () => {
  const root = fixture('/api/mobile/range-workspace');
  try { assert.throws(() => assertMobileRouteManifest(root), /range-workspace/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('the current source tree contains every required mobile route source', () => {
  assert.doesNotThrow(() => assertMobileRouteSources(process.cwd()));
});
