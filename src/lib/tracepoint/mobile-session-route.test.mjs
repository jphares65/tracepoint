import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

let state;
const fresh = () => ({ principal: { userId: 'user' }, memberships: [], identity: { isPlatformAdmin: true, fullName: 'Admin', email: 'admin@example.test' }, agencies: [{ departmentId: '11111111-1111-4111-8111-111111111111', departmentName: 'Agency' }], access: { ok: true, context: { departmentId: '11111111-1111-4111-8111-111111111111', isSupportMode: true } }, audits: [], resolutions: [] });
globalThis.__mobileSupportTest = () => state;
const modules = {
 'next/server': 'export const NextResponse = { json: (body, init) => Response.json(body, init) };',
 '@/lib/authentication/cognito-mobile-session': 'export async function resolveRuntimeCognitoMobileBearer() { return globalThis.__mobileSupportTest().principal; }',
 '@/lib/tracepoint/server-access': 'export const toAccessPayload = context => context;',
 '@/lib/tracepoint/server-access-postgres': `const s = () => globalThis.__mobileSupportTest();
 export async function listPostgresMemberships() { return s().memberships; }
 export async function resolvePostgresIdentitySummary() { return s().identity; }
 export async function listPostgresMobileSupportAgencies() { return s().agencies; }
 export async function resolvePostgresAccess(principal, selected, support) { s().resolutions.push({ selected, support }); return s().access; }
 export async function recordPostgresMobileSupportEntry(principal, selected) { if (s().auditFails) throw Error('audit failure'); s().audits.push(selected); }`,
};
registerHooks({ resolve(specifier, context, next) {
 if (modules[specifier]) return { url: 'data:text/javascript,' + encodeURIComponent(modules[specifier]), shortCircuit: true };
 if (specifier.startsWith('@/')) return { url: new URL('../../' + specifier.slice(2) + '.ts', import.meta.url).href, shortCircuit: true };
 return next(specifier, context);
} });
const { POST } = await import('../../app/api/mobile/session/route.ts');
const id = '11111111-1111-4111-8111-111111111111';
function request(extra = {}, token = true) { return new Request('https://staging.example.test/api/mobile/session', { method: 'POST', headers: { ...(token ? { authorization: 'Bearer test' } : {}), ...extra } }); }
test('session route rejects unauthenticated users and invalid support context', async () => {
 state = fresh(); assert.equal((await POST(request({}, false))).status, 401);
 state.principal = null; assert.equal((await POST(request())).status, 401);
 state = fresh(); assert.equal((await POST(request({ 'x-tracepoint-support-mode': 'true' }))).status, 400);
 assert.equal((await POST(request({ 'x-tracepoint-department-id': id, 'x-tracepoint-support-mode': 'true,false' }))).status, 400);
});
test('platform-only users get support agencies while ordinary users without membership are denied', async () => {
 state = fresh(); const response = await POST(request()); const body = await response.json();
 assert.equal(response.status, 200); assert.equal(body.requiresSupportContext, true); assert.deepEqual(body.supportAgencies, state.agencies); assert.deepEqual(body.memberships, []);
 assert.equal(response.headers.get('cache-control'), 'no-store, private');
 state.identity.isPlatformAdmin = false; assert.equal((await POST(request())).status, 403);
});
test('support selection forwards the explicit context and audits accepted entry', async () => {
 state = fresh(); const response = await POST(request({ 'x-tracepoint-department-id': id, 'x-tracepoint-support-mode': 'true' }));
 assert.equal(response.status, 200); assert.equal((await response.json()).isSupportMode, true);
 assert.deepEqual(state.resolutions, [{ selected: id, support: id }]); assert.deepEqual(state.audits, [id]);
});
test('denied or nonexistent agencies and audit failures cannot establish support access', async () => {
 for (const status of [403, 404]) { state = fresh(); state.access = { ok: false, status, error: 'denied' }; assert.equal((await POST(request({ 'x-tracepoint-department-id': id, 'x-tracepoint-support-mode': 'true' }))).status, status); assert.deepEqual(state.audits, []); }
 state = fresh(); state.auditFails = true; assert.equal((await POST(request({ 'x-tracepoint-department-id': id, 'x-tracepoint-support-mode': 'true' }))).status, 500);
});
test('ordinary agency members retain membership access without support privileges', async () => {
 state = fresh(); state.identity.isPlatformAdmin = false;
 state.memberships = [{ department_id: id, departments: { name: 'Agency' } }]; state.access.context.isSupportMode = false;
 const response = await POST(request({ 'x-tracepoint-department-id': id }));
 assert.equal(response.status, 200); assert.equal((await response.json()).selectionRequired, false);
 assert.deepEqual(state.resolutions, [{ selected: id, support: '' }]); assert.deepEqual(state.audits, []);
 state.memberships.push({ department_id: '22222222-2222-4222-8222-222222222222', departments: { name: 'Other' } });
 assert.equal((await (await POST(request())).json()).memberships.length, 2);
});
