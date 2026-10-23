import assert from 'node:assert/strict';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles = new Set(['officer', 'instructor', 'supervisor', 'administrator']);
const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Y9GiDA5Zy';
// The only object the acceptance run creates: the Agency A patch upload, under that agency's department-assets prefix.
const fixtureObjectKey = /^department-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(patch-[0-9]{1,16}\.(?:png|jpg|webp))$/;
export const stagingAuthUserAnchorSql = `insert into auth.users(id,email,raw_user_meta_data)
  values($1,$2,jsonb_build_object('full_name',$3::text,'identity_provider','cognito'))
  on conflict(id) do nothing`;

export function validateStagingFixtureManifest(manifest, action) {
  assert.equal(['create', 'cleanup', 'verify'].includes(action), true, 'Unsupported fixture action.');
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
  const seenUsernames = new Set();
  const seenEmails = new Set();
  const rolesInFirst = new Set();
  let secondAgencyOfficer = 0;
  for (const user of manifest.users) {
    assert.match(user.id, uuid, 'User identifier is invalid.');
    assert.match(user.subject, uuid, 'Cognito subject is invalid.');
    assert.match(user.username, uuid, 'Cognito fixture username must be the canonical Cognito username.');
    assert.notEqual(user.username, user.email, 'Cognito fixture username must not use the mutable email alias.');
    assert.match(user.email, new RegExp(`^acceptance-${manifest.run}-[a-z]+@example\\.invalid$`), 'Synthetic address is invalid.');
    assert.equal(typeof user.fullName, 'string');
    assert.ok(user.fullName.startsWith('Staging Acceptance '));
    assert.ok(roles.has(user.role), 'Unsupported fixture role.');
    assert.ok(user.agencyIndex === 0 || user.agencyIndex === 1, 'Agency index is invalid.');
    assert.ok(!seenIds.has(user.id) && !seenSubs.has(user.subject) && !seenUsernames.has(user.username) && !seenEmails.has(user.email), 'Fixture identities must be unique.');
    seenIds.add(user.id); seenSubs.add(user.subject); seenUsernames.add(user.username); seenEmails.add(user.email);
    if (user.agencyIndex === 0) rolesInFirst.add(user.role);
    if (user.agencyIndex === 1 && user.role === 'officer') secondAgencyOfficer += 1;
  }
  for (const role of roles) assert.ok(rolesInFirst.has(role), `Agency A is missing ${role}.`);
  assert.equal(secondAgencyOfficer, 1, 'Agency B must have one isolated officer.');
  fixtureStorageObjects(manifest);
  return manifest;
}

/**
 * The storage objects this run recorded creating, as exact keys. Each must be a patch object under one of this run's
 * own agency prefixes; anything else is refused, so storage cleanup can never be pointed outside the run.
 */
export function fixtureStorageObjects(manifest) {
  const keys = manifest?.storageObjects ?? [];
  assert.ok(Array.isArray(keys) && keys.length <= 10, 'Fixture storage objects are invalid.');
  const agencyIds = new Set((manifest.agencies ?? []).map(agency => agency.id));
  for (const key of keys) {
    const match = typeof key === 'string' ? fixtureObjectKey.exec(key) : null;
    assert.ok(match && agencyIds.has(match[1]), "Fixture storage object is outside this run's storage scope.");
  }
  assert.equal(new Set(keys).size, keys.length, 'Fixture storage objects must be unique.');
  return keys.map(key => { const [, agencyId, name] = fixtureObjectKey.exec(key); return { key, agencyId, path: `${agencyId}/${name}` }; });
}

export function isStagingAcceptanceUser(user) {
  const email = user?.Attributes?.find(attribute => attribute.Name === 'email')?.Value ?? '';
  return user?.Username?.startsWith('acceptance-') === true || email.toLowerCase().startsWith('acceptance-');
}

async function fixtureQuery(client, operation, sql, parameters = []) {
  try {
    return await client.query(sql, parameters);
  } catch (error) {
    if (error && typeof error === 'object') error.fixtureOperation = operation;
    throw error;
  }
}

function safeDiagnosticText(value) {
  if (typeof value !== 'string' || !value) return undefined;
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/'[^']*'/g, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[redacted-id]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{48,})\b/g, '[redacted-token]')
    .replace(/(?:failing row contains|key \([^)]*\)=).*/i, '[redacted-row-values]')
    .replace(/\b(password|secret|token|authorization)\s*[:=]\s*[^,; ]+/gi, '$1=[redacted]')
    .slice(0, 320);
}

export function sanitizeFixturePostgresDiagnostic(error, stage) {
  const code = String(error?.code ?? '');
  const safeIdentifier = value => /^[a-z_][a-z0-9_]{0,62}$/.test(String(value ?? '')) ? String(value) : undefined;
  const safeOperation = value => /^[a-z_][a-z0-9_.]{0,127}$/.test(String(value ?? '')) ? String(value) : undefined;
  const diagnostic = {
    stage,
    ...(safeOperation(error?.fixtureOperation) ? { operation: safeOperation(error.fixtureOperation) } : {}),
    sqlstate: /^[0-9A-Z]{5}$/.test(code) ? code : undefined,
    ...(safeDiagnosticText(error?.message) ? { message: safeDiagnosticText(error.message) } : {}),
    ...(Number.isInteger(Number(error?.position)) && Number(error.position) > 0 ? { position: Number(error.position) } : {}),
    ...(safeDiagnosticText(error?.detail) ? { detail: safeDiagnosticText(error.detail) } : {}),
    ...(safeDiagnosticText(error?.hint) ? { hint: safeDiagnosticText(error.hint) } : {}),
    ...(safeDiagnosticText(error?.where) ? { executionContext: safeDiagnosticText(error.where) } : {}),
    ...(safeIdentifier(error?.schema) ? { schema: safeIdentifier(error.schema) } : {}),
    ...(safeIdentifier(error?.table) ? { table: safeIdentifier(error.table) } : {}),
    ...(safeIdentifier(error?.column) ? { column: safeIdentifier(error.column) } : {}),
    ...(safeIdentifier(error?.routine) ? { routine: safeIdentifier(error.routine) } : {}),
  };
  return Object.fromEntries(Object.entries(diagnostic).filter(([, value]) => value !== undefined));
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

  await fixtureQuery(client, 'transaction.begin', action === 'verify' ? 'begin read only' : 'begin');
  try {
    if (action === 'create') await createFixture(client, manifest);
    else if (action === 'verify') await verifyFixtureOwnership(client, manifest);
    else await cleanupFixture(client, manifest);
    await fixtureQuery(client, 'transaction.commit', 'commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
  return { fixtureRun: manifest.run, action, agencies: manifest.agencies.length, users: manifest.users.length, roles: [...new Set(manifest.users.map(user => user.role))].sort(), databaseTarget: 'tracepoint-staging-full-aws' };
}

async function createFixture(client, manifest) {
  const existing = await fixtureQuery(client, 'preflight.find_fixture_agencies', 'select id from public.departments where slug = any($1::text[])', [manifest.agencies.map(agency => agency.slug)]);
  if (existing.rowCount) throw new Error('Fixture agency slug already exists.');
  const identityCollision = await fixtureQuery(client, 'preflight.check_identity_collisions', `select 1 from public.profiles where id=any($1::uuid[]) or email=any($2::text[])
    union all select 1 from auth.users where id=any($1::uuid[]) or email=any($2::text[])
    union all select 1 from public.authentication_identity_links where provider='cognito' and issuer=$3 and
      (subject=any($4::text[]) or provider_username=any($5::text[])) limit 1`, [manifest.users.map(user => user.id), manifest.users.map(user => user.email), manifest.issuer, manifest.users.map(user => user.subject), manifest.users.map(user => user.username)]);
  if (identityCollision.rowCount) throw new Error('Fixture identity already exists.');
  const activeFeature = await fixtureQuery(client, 'preflight.verify_equipment_feature', "select code from public.feature_catalog where code='equipment_readiness' and is_active");
  if (activeFeature.rowCount !== 1) throw new Error('Required staging acceptance module is unavailable.');
  const admin = manifest.users.find(user => user.agencyIndex === 0 && user.role === 'administrator');

  for (const agency of manifest.agencies) {
    await fixtureQuery(client, 'agency.create_department', 'insert into public.departments(id,name,short_name,slug,is_active) values($1,$2,$3,$4,true)', [agency.id, `Staging Acceptance ${manifest.run.slice(0, 8)}-${agency.slug.endsWith('-0') ? 'A' : 'B'}`, 'Acceptance', agency.slug]);
    await fixtureQuery(client, 'agency.enable_equipment_feature', `insert into public.department_features(department_id,feature_code,is_enabled,enabled_at,updated_at)
      values($1,'equipment_readiness',true,now(),now()) on conflict(department_id,feature_code) do update set is_enabled=true,enabled_at=now(),disabled_at=null,updated_at=now()`, [agency.id]);
  }
  for (const user of manifest.users) {
    const departmentId = manifest.agencies[user.agencyIndex].id;
    // AWS-native auth.users is a minimal application identity anchor. The
    // on_auth_user_created trigger creates the profile from these fields.
    await fixtureQuery(client, 'identity.create_auth_user_anchor', stagingAuthUserAnchorSql, [user.id, user.email, user.fullName]);
    await fixtureQuery(client, 'identity.upsert_profile', `insert into public.profiles(id,full_name,email) values($1,$2,$3)
      on conflict(id) do update set full_name=excluded.full_name,email=excluded.email`, [user.id, user.fullName, user.email]);
    await fixtureQuery(client, 'identity.link_cognito_subject', `insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username)
      values('cognito',$1,$2,$3,'active',$4)`, [manifest.issuer, user.subject, user.id, user.username]);
    await fixtureQuery(client, 'membership.create', `insert into public.department_memberships(department_id,user_id,is_active)
      values($1,$2,true)`, [departmentId, user.id]);
  }
  // assigned_by references auth.users, so the Administrator anchor must exist
  // before any other synthetic role row is assigned to it.
  for (const user of manifest.users) {
    const departmentId = manifest.agencies[user.agencyIndex].id;
    await fixtureQuery(client, 'membership.assign_role', `insert into public.department_membership_roles(department_id,user_id,role_code,assigned_by)
      values($1,$2,$3,$4)`, [departmentId, user.id, user.role, user.agencyIndex === 0 && user.role !== 'administrator' ? admin.id : null]);
  }
}

/**
 * Read-only proof, from the staging database rather than from local files, that the manifest's agencies are this
 * run's synthetic agencies and that every storage object it names was uploaded into one of them by one of its
 * identities. Storage cleanup runs only after this succeeds.
 */
async function verifyFixtureOwnership(client, manifest) {
  const agencyIds = manifest.agencies.map(agency => agency.id);
  const userIds = manifest.users.map(user => user.id);
  const objects = fixtureStorageObjects(manifest);
  const agencies = await fixtureQuery(client, 'ownership.read_agencies', 'select id::text as id, slug, name from public.departments where id=any($1::uuid[])', [agencyIds]);
  if (!agencies.rowCount) {
    if (objects.length) throw new Error("Fixture storage objects cannot be attributed: the run's agencies are absent.");
    return;
  }
  for (const [index, agency] of manifest.agencies.entries()) {
    const row = agencies.rows.find(candidate => candidate.id === agency.id);
    const name = `Staging Acceptance ${manifest.run.slice(0, 8)}-${index === 0 ? 'A' : 'B'}`;
    if (!row || row.slug !== agency.slug || row.name !== name) throw new Error('Fixture agency does not belong to this run.');
  }
  const users = await fixtureQuery(client, 'ownership.read_identities', `select p.id from public.profiles p
    join public.authentication_identity_links l on l.tracepoint_user_id=p.id and l.provider='cognito' and l.issuer=$1
    where p.id=any($2::uuid[]) and l.subject=any($3::text[]) and p.email=any($4::text[])`, [manifest.issuer, userIds, manifest.users.map(user => user.subject), manifest.users.map(user => user.email)]);
  if (users.rowCount !== manifest.users.length) throw new Error('Fixture identities do not match the recorded Cognito subjects.');
  const foreign = await fixtureQuery(client, 'ownership.find_foreign_members', `select
    (select count(*) from public.department_memberships where department_id=any($1::uuid[]) and user_id<>all($2::uuid[]))::int as foreign_members,
    (select count(*) from public.department_memberships where user_id=any($2::uuid[]) and department_id<>all($1::uuid[]))::int as outside_memberships`, [agencyIds, userIds]);
  if (foreign.rows[0].foreign_members || foreign.rows[0].outside_memberships) throw new Error('Fixture agency has members outside this run.');
  for (const object of objects) {
    const attested = await fixtureQuery(client, 'ownership.attest_storage_object', `select 1 from public.audit_events
      where department_id=$1::uuid and action='department_patch_upload' and actor_user_id=any($2::uuid[]) and details->>'storage_path'=$3 limit 1`, [object.agencyId, userIds, object.path]);
    if (attested.rowCount !== 1) throw new Error('Fixture storage object was not created by this run.');
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
  await verifyFixtureOwnership(client, manifest);
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
