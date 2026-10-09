import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_MOBILE_ROUTES = Object.freeze([
  '/api/mobile/session',
  '/api/mobile/qr/resolve',
  '/api/mobile/range-days',
  '/api/mobile/range-days/[rangeDayId]',
  '/api/mobile/range-workspace',
  '/api/mobile/drill-documents/[documentId]/view',
]);

export function assertMobileRouteSources(sourceRoot) {
  for (const route of REQUIRED_MOBILE_ROUTES) {
    const source = join(sourceRoot, 'src', 'app', ...route.split('/').filter(Boolean), 'route.ts');
    assert.ok(existsSync(source), `Required mobile route source is absent: ${route}`);
  }
}

export function assertMobileRouteManifest(nextRoot) {
  const appPaths = JSON.parse(readFileSync(join(nextRoot, 'app-path-routes-manifest.json'), 'utf8'));
  const routes = JSON.parse(readFileSync(join(nextRoot, 'routes-manifest.json'), 'utf8'));
  const appRoutePaths = new Set(Object.values(appPaths));
  const nextRoutePaths = new Set([
    ...(routes.staticRoutes ?? []).map((route) => route.page),
    ...(routes.dynamicRoutes ?? []).map((route) => route.page),
  ]);
  for (const route of REQUIRED_MOBILE_ROUTES) {
    assert.ok(appRoutePaths.has(route), `Required mobile route is absent from app-path-routes-manifest: ${route}`);
    assert.ok(nextRoutePaths.has(route), `Required mobile route is absent from routes-manifest: ${route}`);
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceRoot = readArgument('--source-root');
  const nextRoot = readArgument('--next-root');
  assert.ok(sourceRoot || nextRoot, 'Specify --source-root and/or --next-root.');
  if (sourceRoot) assertMobileRouteSources(sourceRoot);
  if (nextRoot) assertMobileRouteManifest(nextRoot);
  console.log(JSON.stringify({ mobileRouteContract: 'passed', source: Boolean(sourceRoot), artifact: Boolean(nextRoot) }));
}
