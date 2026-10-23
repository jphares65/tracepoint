import assert from 'node:assert/strict';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles = new Set(['officer', 'instructor', 'supervisor', 'administrator']);
const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Y9GiDA5Zy';

export function validateStagingFixtureManifest(manifest, action) {
  assert.equal(action === 'create' || action === 'cleanup', true, 'Unsupported fixture action.');
  assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Fixture manifest is invalid.');
  assert.equal(manifest.environment, 'staging', 'Fixtures are staging-only.');
  assert.match(manifest.run, uuid, 'Fixture run identifier is invalid.');
  assert.equal(manifest.poolId, 'us-east-1_Y9GiDA5Zy', 'Unexpected Cognito pool.');
  assert.equal(manifest.issuer, issuer, 'Unexpected Cognito issuer.');
  assert.doesNotMatch(JSON.stringify(manifest), /"(?:password|temporaryPassword|mfaSecret|totpSecret|accessToken|refreshToken)"\s*:/i, 'Authentication secrets are forbidden in fixture manifests.');
  assert.equal(manifest.agencies?.length, 2, 'Exactly two synthetic agencies are required.');
  for (const [index, agency] of manifest.agencies.entries()) {
    assert.match(agency.id, uuid, 'Agency identifier is invalid.');
    assert.equal(agency.slug, `acceptance-${manifest.run}-${index}`, 'Agency slug must be bound to this run.');
  }
  assert.ok(Array.isArray(manifest.users) && manifest.users.length === 5, 'Exactly five synthetic identities are required.');
  const seenIds = new Set();
  const seenSubs = new Set();
  const seenEmails = new Set();
  const rolesInFirst = new Set();
  let secondAgencyOfficer = 0;
  for (const user of manifest.users) {
    assert.match(user.id, uuid, 'User identifier is invalid.');
    assert.match(user.subject, uuid, 'Cognito subject is invalid.');
    assert.equal(user.username, user.email, 'Cognito fixture username must match its synthetic address.');
    assert.match(user.email, new RegExp(`^acceptance-${manifest.run}-[a-z]+@example\\.invalid$`), 'Synthetic address is invalid.');
    assert.equal(typeof user.fullName, 'string');
    assert.ok(user.fullName.startsWith('Staging Acceptance '));
    assert.ok(roles.has(user.role), 'Unsupported fixture role.');
    assert.ok(user.agencyIndex === 0 || user.agencyIndex === 1, 'Agency index is invalid.');
    assert.ok(!seenIds.has(user.id) && !seenSubs.has(user.subject) && !seenEmails.has(user.email), 'Fixture identities must be unique.');
    seenIds.add(user.id); seenSubs.add(user.subject); seenEmails.add(user.email);
    if (user.agencyIndex === 0) rolesInFirst.add(user.role);
    if (user.agencyIndex === 1 && user.role === 'officer') secondAgencyOfficer += 1;
  }
  for (const role of roles) assert.ok(rolesInFirst.has(role), `Agency A is missing ${role}.`);
  assert.equal(secondAgencyOfficer, 1, 'Agency B must have one isolated officer.');
  return manifest;
}

export async function applyStagingFixture(client, action, input, environment = process.env) {
  if (environment.CONFIGURATION_ENVIRONMENT !== 'staging' || environment.TRACEPOINT_RUNTIME_PROVIDER_MODE !== 'aws-native') {
    throw new Error('Staging AWS-native runtime configuration is required.');
  }
  const manifest = validateStagingFixtureManifest(input, action);
  const expectedHost = String(environment.TRACEPOINT_EXPECTED_DATABASE_HOST ?? '').toLowerCase().replace(/\.$/, '');
  const actualHost = String(environment.TRACEPOINT_DATABASE_SECRET_JSON ? JSON.parse(environment.TRACEPOINT_DATABASE_SECRET_JSON).host : '').toLowerCase().replace(/\.$/, '');
  if (!expectedHost || actualHost !== expectedHost || !expectedHost.includes('tracepoint-staging-full-aws')) {
    throw new Error('Fixture database target does not match the pinned staging instance.');
  }

  await client.query('begin');
  try {
    if (action === 'create') await createFixture(client, manifest);
    else await cleanupFixture(client, manifest);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
  return { fixtureRun: manifest.run, action, agencies: manifest.agencies.length, users: manifest.users.length, roles: [...new Set(manifest.users.map(user => user.role))].sort(), databaseTarget: 'tracepoint-staging-full-aws' };
}

async function createFixture(client, manifest) {
  const existing = await client.query('select id from public.departments where slug = any($1::text[])', [manifest.agencies.map(agency => agency.slug)]);
  if (existing.rowCount) throw new Error('Fixture agency slug already exists.');
  const activeFeature = await client.query("select code from public.feature_catalog where code='equipment_readiness' and is_active");
  if (activeFeature.rowCount !== 1) throw new Error('Required staging acceptance module is unavailable.');
  const admin = manifest.users.find(user => user.agencyIndex === 0 && user.role === 'administrator');

  for (const agency of manifest.agencies) {
    await client.query('insert into public.departments(id,name,short_name,slug,is_active) values($1,$2,$3,$4,true)', [agency.id, `Staging Acceptance ${manifest.run.slice(0, 8)}-${agency.slug.endsWith('-0') ? 'A' : 'B'}`, 'Acceptance', agency.slug]);
    await client.query(`insert into public.department_features(department_id,feature_code,is_enabled,enabled_at,updated_at)
      values($1,'equipment_readiness',true,now(),now()) on conflict(department_id,feature_code) do update set is_enabled=true,enabled_at=now(),disabled_at=null,updated_at=now()`, [agency.id]);
  }
  for (const user of manifest.users) {
    const departmentId = manifest.agencies[user.agencyIndex].id;
    await client.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'authenticated','authenticated',$2,'',null,'{"provider":"cognito","providers":["cognito"]}'::jsonb,jsonb_build_object('full_name',$3),now(),now())
      on conflict(id) do nothing`, [user.id, user.email, user.fullName]);
    await client.query(`insert into public.profiles(id,full_name,email) values($1,$2,$3)
      on conflict(id) do update set full_name=excluded.full_name,email=excluded.email`, [user.id, user.fullName, user.email]);
    await client.query(`insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username)
      values('cognito',$1,$2,$3,'active',$4)`, [manifest.issuer, user.subject, user.id, user.email]);
    await client.query(`insert into public.department_memberships(department_id,user_id,is_active,activation_status)
      values($1,$2,true,'activated')`, [departmentId, user.id]);
    await client.query(`insert into public.department_membership_roles(department_id,user_id,role_code,assigned_by)
      values($1,$2,$3,$4)`, [departmentId, user.id, user.role, user.agencyIndex === 0 && user.role !== 'administrator' ? admin.id : null]);
  }
}

async function cleanupFixture(client, manifest) {
  const agencyIds = manifest.agencies.map(agency => agency.id);
  const before = await client.query(`select
    (select count(*) from public.departments where id=any($1::uuid[]) and slug=any($2::text[]))::int as agencies,
    (select count(*) from public.profiles where id=any($3::uuid[]))::int as profiles,
    (select count(*) from public.authentication_identity_links where provider='cognito' and issuer=$4 and subject=any($5::text[]))::int as identities`, [agencyIds, manifest.agencies.map(agency => agency.slug), manifest.users.map(user => user.id), manifest.issuer, manifest.users.map(user => user.subject)]);
  if (!before.rows[0].agencies && !before.rows[0].profiles && !before.rows[0].identities) return;
  if (before.rows[0].agencies !== manifest.agencies.length || before.rows[0].profiles !== manifest.users.length || before.rows[0].identities !== manifest.users.length) {
    throw new Error('Fixture cleanup target is incomplete or does not match this run.');
  }
  const users = await client.query(`select p.id from public.profiles p
    join public.authentication_identity_links l on l.tracepoint_user_id=p.id and l.provider='cognito' and l.issuer=$1
    where p.id=any($2::uuid[]) and l.subject=any($3::text[]) and p.email=any($4::text[])`, [manifest.issuer, manifest.users.map(user => user.id), manifest.users.map(user => user.subject), manifest.users.map(user => user.email)]);
  if (users.rowCount !== manifest.users.length) throw new Error('Fixture cleanup identity set does not match the recorded Cognito subjects.');
  const ownedAgencies = await client.query('select id from public.departments where id=any($1::uuid[]) and slug=any($2::text[])', [agencyIds, manifest.agencies.map(agency => agency.slug)]);
  if (ownedAgencies.rowCount !== manifest.agencies.length) throw new Error('Fixture cleanup agency set does not match the recorded run.');
  const unexpectedMemberships = await client.query(`select count(*)::int as count from public.department_memberships
    where user_id=any($1::uuid[]) and department_id<>all($2::uuid[])`, [manifest.users.map(user => user.id), agencyIds]);
  if (unexpectedMemberships.rows[0].count !== 0) throw new Error('Fixture identity is linked to a non-fixture agency.');
  await client.query('delete from public.equipment_asset_assignments where department_id=any($1::uuid[])', [agencyIds]);
  await client.query('delete from public.equipment_assets where department_id=any($1::uuid[])', [agencyIds]);
  await client.query('delete from public.equipment_types where department_id=any($1::uuid[])', [agencyIds]);
  await client.query('delete from public.department_feature_events where department_id=any($1::uuid[])', [agencyIds]);
  await client.query('delete from public.department_features where department_id=any($1::uuid[])', [agencyIds]);
  await client.query('delete from public.departments where id=any($1::uuid[]) and slug=any($2::text[])', [agencyIds, manifest.agencies.map(agency => agency.slug)]);
  await client.query('delete from auth.users where id=any($1::uuid[])', [manifest.users.map(user => user.id)]);
  const remaining = await client.query(`select
    (select count(*) from public.departments where id=any($1::uuid[]))::int as agencies,
    (select count(*) from public.profiles where id=any($2::uuid[]))::int as profiles,
    (select count(*) from public.authentication_identity_links where provider='cognito' and issuer=$3 and subject=any($4::text[]))::int as identities`, [agencyIds, manifest.users.map(user => user.id), manifest.issuer, manifest.users.map(user => user.subject)]);
  if (remaining.rows[0].agencies || remaining.rows[0].profiles || remaining.rows[0].identities) throw new Error('Fixture cleanup verification failed.');
}
