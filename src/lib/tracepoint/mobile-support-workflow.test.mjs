import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
let state;
globalThis.__mobileWorkflowTest = () => state;
const modules = {
 'server-only': '',
 'next/server': 'export const NextResponse = { json: (body, init) => Response.json(body, init) };',
 'next/headers': 'export async function headers() { return globalThis.__mobileWorkflowTest().request.headers; } export async function cookies() { return { get: () => undefined }; }',
 '@/lib/authentication/request-bearer': 'export const readBearerToken = () => null;',
 '@/lib/authentication/request-session': 'export const resolveAuthenticatedPrincipal = async () => null;',
 '@/lib/authentication/cognito-mobile-session': 'export const resolveRuntimeCognitoMobileBearer = async () => ({ userId: "user" });',
 '@/lib/authentication/cognito-runtime-configuration-core': 'export const parseCognitoTargetConfiguration = () => ({});',
 '@/lib/authentication/production-session-diagnostic': 'export const productionSessionDiagnostic = () => ({}); export const emitProductionSessionDiagnostic = () => {}; export const withResolvedCognitoPrincipal = () => {};',
 '@/lib/tracepoint/permission-authority': 'export const effectiveDepartmentPermissions = () => [];',
 '@/lib/tracepoint/tenant-context': 'export const resolveTenantContext = () => ({});',
 '@/lib/tracepoint/server-access-postgres': `const s=()=>globalThis.__mobileWorkflowTest();
 export async function resolvePostgresAccess(principal, selected, support) { s().resolutions.push({selected,support}); return s().allowed ? {ok:true,context:{departmentId:selected,isSupportMode:Boolean(support)}} : {ok:false,status:403,error:'denied'}; }
 export async function recordPostgresMobileSupportEntry(principal, selected) { if(s().auditFails) throw Error('audit failure'); s().audits.push(selected); }`,
};
registerHooks({ resolve(specifier, context, next) {
 if (Object.hasOwn(modules, specifier)) return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};
 if (specifier.startsWith('@/')) return {url:new URL('../../'+specifier.slice(2)+'.ts',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}});
const { resolveServerAccess } = await import('./server-access.ts');
process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE='aws-native';
const id='11111111-1111-4111-8111-111111111111';
function prepare(path='/api/mobile/equipment/assets',support='true') { state={allowed:true,audits:[],resolutions:[],request:new Request('https://example.test'+path,{headers:{authorization:'Bearer test','x-tracepoint-department-id':id,...(support ? {'x-tracepoint-support-mode':support}: {})}})}; }
test('workflow calls forward support context and audit before granting access', async()=>{prepare();const result=await resolveServerAccess(state.request);assert.equal(result.ok,true);assert.deepEqual(state.resolutions,[{selected:id,support:id}]);assert.deepEqual(state.audits,[id]);});
test('denied support and failed audits block workflow access',async()=>{prepare();state.allowed=false;assert.equal((await resolveServerAccess(state.request)).ok,false);assert.deepEqual(state.audits,[]);prepare();state.auditFails=true;assert.equal((await resolveServerAccess(state.request)).status,500);});
test('ordinary membership requests retain normal context without support audit',async()=>{prepare('/api/mobile/fleet/vehicles','');const result=await resolveServerAccess(state.request);assert.equal(result.ok,true);assert.deepEqual(state.resolutions,[{selected:id,support:''}]);assert.deepEqual(state.audits,[]);});
test('support headers cannot enable bearer authentication on browser routes',async()=>{prepare('/api/platform/support-mode');assert.equal((await resolveServerAccess(state.request)).status,401);assert.deepEqual(state.resolutions,[]);assert.deepEqual(state.audits,[]);});
