import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CognitoCallbackRejectedError } from './staging-cognito-login.mjs';
import { runAuthenticatedAcceptance } from './test-staging-cognito-acceptance.mjs';

// The authenticated run signs each synthetic user in exactly once (a second Cognito PKCE+MFA sign-in timed out in
// run 4c66f928) and does all of that user's checks, including the final D-2 audit read, on the session that sign-in
// established. The fake browser answers the staging API in memory and refuses any request from a context that has not
// signed in, so a check that silently opened a new session or skipped sign-in would fail here.
const run = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const agencies = [0, 1].map(index => ({ id: `0a000000-0000-4000-8000-00000000000${index + 1}`, slug: `acceptance-${run}-${index}` }));
const users = ['administrator', 'officer', 'instructor', 'supervisor', 'foreign'].map((role, index) => ({
  id: `1a000000-0000-4000-8000-00000000000${index + 1}`, email: `acceptance-${run}-${role}@example.invalid`,
  role: role === 'foreign' ? 'officer' : role, agencyIndex: role === 'foreign' ? 1 : 0,
}));
const manifest = { run, agencies, users };

function fakeStaging({ accessUserId = user => user.id } = {}) {
  const state = { types: [], assets: [], firearms: [], audit: [], signIns: new Map(), contexts: [], closedBeforeSignOut: [] };
  const reply = (status, body = {}) => ({ status: () => status, json: async () => body });
  const handle = (session, method, url, options = {}) => {
    if (!session.user) return reply(401);
    const { user } = session;
    const agency = agencies[user.agencyIndex].id;
    const admin = user.role === 'administrator';
    const { pathname, searchParams } = new URL(url, 'https://staging.tracepointhq.com');
    const data = options.data ?? {};
    const route = `${method} ${pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/g, '/:id')}`;
    switch (route) {
      case 'GET /api/access':
        return reply(200, { access: { userId: accessUserId(user), departmentId: agency, roleCodes: [user.role], permissions: admin ? ['administer_department'] : [] } });
      case 'POST /api/equipment/types': {
        if (!admin) return reply(403);
        const item = { id: crypto.randomUUID(), department_id: agency, name: data.name };
        state.types.push(item);
        return reply(201, { item });
      }
      case 'PATCH /api/equipment/types': {
        const item = state.types.find(candidate => candidate.id === data.id);
        item.name = data.name;
        return reply(200, { item });
      }
      case 'GET /api/equipment/types': return reply(200, { items: state.types.filter(item => item.department_id === agency) });
      case 'POST /api/equipment/assets': {
        const item = { id: crypto.randomUUID(), department_id: agency, assigned_user_id: data.assignedUserId, lifecycle_status: data.lifecycleStatus, notes: '' };
        state.assets.push(item);
        return reply(201, { item });
      }
      case 'GET /api/equipment/assets': return reply(200, { items: state.assets.filter(item => item.department_id === agency) });
      case 'GET /api/equipment/custody': return state.assets.some(item => item.id === searchParams.get('identifier') && item.department_id === agency)
        ? reply(200) : reply(404, { error: 'Equipment not found.' });
      case 'POST /api/equipment/custody': {
        const item = state.assets.find(candidate => candidate.id === data.id && candidate.department_id === agency && candidate.assigned_user_id === user.id);
        if (!item) return reply(404, { error: 'Equipment not found.' });
        Object.assign(item, { lifecycle_status: 'out_of_service', notes: `[condition=${data.condition}] [reported_by=${user.id}]` });
        state.audit.push({ department_id: agency, action: 'report', entity_type: 'equipment_asset', entity_id: item.id, changed_by_user_id: user.id,
          new_values: { equipment_asset_id: item.id, condition: data.condition, lifecycle_status: 'out_of_service' } });
        return reply(200, { item: { ...item, custody: 'mine' } });
      }
      case 'POST /api/armory/firearms': {
        if (!admin) return reply(403);
        const firearm = { id: crypto.randomUUID(), agency, assignee: data.assignedToUserId };
        state.firearms.push(firearm);
        return reply(201, { firearmId: firearm.id, assignmentCreated: true });
      }
      case 'PUT /api/armory/firearms/:id/custody': return admin ? reply(200) : reply(403);
      case 'POST /api/armory/firearms/:id/custody': {
        // Migration 067: the assigned officer or a custody manager may operate restricted custody. The firearm is
        // already in its assignee's custody, so an authorized CHECK_OUT is refused as not ready (409).
        // Another agency has no issued Duty Only firearm with this id, which the application refuses with 409.
        const firearm = state.firearms.find(candidate => pathname.includes(candidate.id) && candidate.agency === agency);
        if (!firearm) return reply(409);
        if (firearm.assignee !== user.id && !admin) return reply(403);
        return data.action === 'CHECK_OUT' ? reply(409) : reply(200);
      }
      case 'PATCH /api/fleet/vehicles':
      case 'PATCH /api/armory/firearms/:id/status':
      case 'POST /api/armory/firearms/:id/assignments': return admin ? reply(200) : reply(403);
      case 'POST /api/settings/department-patch':
        state.audit.push({ department_id: agency, action: 'department_patch_upload', new_values: { result: 'succeeded' } });
        return reply(200, { patchUrl: `/api/storage/object?path=${agency}/patch-1761234567890.png` });
      case 'GET /api/settings/audit-log': return admin ? reply(200, { events: state.audit.filter(event => event.department_id === agency) }) : reply(403);
      case 'POST /api/auth/cognito/logout': session.user = undefined; return reply(200);
      default: throw new Error(`Unexpected staging request: ${route}`);
    }
  };
  const browser = {
    newContext: async () => {
      const session = { user: undefined, requests: 0, closed: false };
      const request = Object.fromEntries(['get', 'post', 'patch', 'put'].map(method => [method, async (url, options) => {
        assert.equal(session.closed, false, 'a closed session was reused');
        session.requests += 1;
        return handle(session, method.toUpperCase(), url, options);
      }]));
      const context = {
        session, request,
        route: async () => {},
        addCookies: async () => {},
        newPage: async () => ({ context, reload: async () => {} }),
        close: async () => { session.closed = true; },
      };
      state.contexts.push(context);
      return context;
    },
    close: async () => {},
  };
  const login = async ({ page, email }) => {
    const user = users.find(candidate => candidate.email === email);
    assert.equal(page.context.session.user, undefined, 'a session signed in twice');
    state.signIns.set(email, (state.signIns.get(email) ?? 0) + 1);
    page.context.session.user = user;
  };
  return { state, browser, login };
}

test('each synthetic user signs in exactly once and every check reuses that session', async () => {
  const { state, browser, login } = fakeStaging();
  const stored = [];
  const { results } = await runAuthenticatedAcceptance({
    manifest, passwords: new Map(users.map(user => [user.email, 'unused-by-fake'])),
    launchBrowser: async () => browser, login, onStorageObject: async key => { stored.push(key); },
  });
  assert.deepEqual(results.filter(result => result.status !== 'pass'), []);
  assert.deepEqual([...state.signIns.entries()], users.map(user => [user.email, 1]));
  // One browser context per user, each signed in once and used for every one of that user's requests.
  assert.equal(state.contexts.length, users.length);
  assert.ok(state.contexts.every(context => context.session.requests > 1));
  // The D-2 audit read after the loop ran on the administrator's original session, which was then signed out.
  assert.ok(results.some(result => result.name === 'D-2 normalized audit event identifies the agency, Officer, and equipment'));
  assert.equal(state.contexts[0].session.user, undefined);
  assert.ok(state.contexts.every(context => context.session.closed));
  assert.deepEqual(stored, [`department-assets/${agencies[0].id}/patch-1761234567890.png`]);
  for (const check of ['D-2 Officer condition report persists after reload', 'Agency B cannot read Agency A equipment by direct API',
    'Agency B cannot modify Agency A equipment by direct API', 'Agency B equipment directory excludes Agency A asset',
    'unauthorized-equipment-management-refused', 'unauthorized-firearm-restriction-management-refused']) {
    assert.ok(results.some(result => result.name === check), check);
  }
});

// Run cd66c7a4: the firearm was assigned to the Supervisor, who as its assignee is authorized for restricted custody, so
// the Supervisor's refusal check got 409 instead of 403. No role whose refusal is checked may be the assignee.
test('the Duty Only firearm is assigned to the Administrator and every refused role gets the expected custody refusal', async () => {
  const { state, browser, login } = fakeStaging();
  const { results } = await runAuthenticatedAcceptance({ manifest, passwords: new Map(), launchBrowser: async () => browser, login });
  assert.deepEqual(results.filter(result => result.status !== 'pass'), []);
  assert.equal(state.firearms.length, 1);
  assert.equal(state.firearms[0].assignee, users[0].id);
  const custody = results.filter(result => result.name === 'unauthorized-restricted-firearm-custody-refused').map(result => result.evidence.actual.httpStatus);
  // Officer, Instructor and Supervisor in Agency A (403), then the Agency B Officer (409: no such firearm in Agency B).
  assert.deepEqual(custody, [403, 403, 403, 409]);
  const provisioned = results.find(result => result.name === 'Administrator provisions a temporary assigned Duty Only firearm for authorization checks');
  assert.equal(provisioned.evidence.actual.assignedToAdministrator, true);
});

test('a firearm assigned to a refused role fails that role\'s custody refusal check, as the assignee is authorized', async () => {
  const { browser, login } = fakeStaging();
  const reassignToSupervisor = {
    ...browser,
    newContext: async options => {
      const context = await browser.newContext(options);
      const post = context.request.post;
      context.request.post = (url, request) => post(url, url === '/api/armory/firearms' && request?.data?.make === 'Acceptance'
        ? { ...request, data: { ...request.data, assignedToUserId: users[3].id } } : request);
      return context;
    },
  };
  const { results } = await runAuthenticatedAcceptance({ manifest, passwords: new Map(), launchBrowser: async () => reassignToSupervisor, login });
  const failure = results.at(-1);
  assert.equal(failure.status, 'fail');
  assert.equal(failure.name, 'unauthorized-restricted-firearm-custody-refused');
  assert.equal(failure.role, 'supervisor');
  assert.deepEqual(failure.evidence.actual, { httpStatus: 409, refused: false });
});

test('a failed sign-in is not retried with a second sign-in', async () => {
  const { state, browser } = fakeStaging();
  let attempts = 0;
  const { results } = await runAuthenticatedAcceptance({
    manifest, passwords: new Map(), launchBrowser: async () => browser,
    login: async () => { attempts += 1; throw Object.assign(new Error('MFA step timed out'), { name: 'TimeoutError' }); },
  });
  assert.equal(attempts, 1);
  assert.equal(state.contexts.length, 1);
  assert.equal(results.at(-1).status, 'fail');
  assert.equal(results.at(-1).code, 'BROWSER_TIMEOUT');
});

test('a sign-in passes only when the application session resolves to that exact user', async () => {
  const { browser, login } = fakeStaging({ accessUserId: user => (user.role === 'instructor' ? users[0].id : user.id) });
  const { results } = await runAuthenticatedAcceptance({ manifest, passwords: new Map(), launchBrowser: async () => browser, login });
  const failure = results.at(-1);
  assert.equal(failure.status, 'fail');
  assert.equal(failure.role, 'instructor');
  assert.deepEqual(failure.evidence.actual, { httpStatus: 200, userMatches: false, tenantMatches: true, rolePresent: true });
  assert.equal(results.some(result => result.name === 'instructor authenticates through Cognito PKCE/MFA'), false);
});

test('a refused sign-in callback is reported as such, with its safe diagnostics, and is not retried', async () => {
  const { state, browser, login } = fakeStaging();
  let instructorAttempts = 0;
  const { results } = await runAuthenticatedAcceptance({
    manifest, passwords: new Map(), launchBrowser: async () => browser,
    login: async input => {
      if (!input.email.endsWith('-instructor@example.invalid')) return login(input);
      instructorAttempts += 1;
      throw new CognitoCallbackRejectedError({ callbackStatus: 303, callbackLanding: 'login', loginNotice: 'authorization_rejected', providerError: 'none',
        callbackHadCode: true, callbackHadState: true, flowCookiePresent: true, callbacksSeen: 1, signInStarts: 1, callbackSeconds: 41 });
    },
  });
  assert.equal(instructorAttempts, 1);
  assert.deepEqual([...state.signIns.keys()], [users[0].email, users[1].email]);
  const failure = results.at(-1);
  assert.equal(failure.code, 'COGNITO_CALLBACK_REJECTED');
  assert.equal(failure.role, 'instructor');
  assert.equal(failure.diagnostics.loginNotice, 'authorization_rejected');
  assert.equal(failure.diagnostics.callbackLanding, 'login');
  assert.equal(failure.diagnostics.callbackSeconds, 41);
});
