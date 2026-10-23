import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  AdminCreateUserCommand, AdminDeleteUserCommand, AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient, DescribeUserPoolClientCommand, GetUserPoolMfaConfigCommand, ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteObjectCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { runAuthenticatedAcceptance } from './test-staging-cognito-acceptance.mjs';
import { isStagingAcceptanceUser, validateStagingFixtureManifest } from './staging-cognito-fixture-core.mjs';
import { fixtureStoragePrefix, planFixtureStorageDeletion } from './staging-acceptance-fixture-storage.mjs';
import { assertManifestMatchesMarker, createFixtureRunDirectory, openFixtureManifest, removeFixtureRunDirectory } from './staging-acceptance-fixture-directory.mjs';

const account = '559054714699';
const region = 'us-east-1';
const poolId = 'us-east-1_Y9GiDA5Zy';
const clientId = '4apeul5qohqgnf7d10ta2lk5qe';
const callback = 'https://staging.tracepointhq.com/api/auth/cognito/callback';
const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
process.env.AWS_PROFILE ??= process.env.TRACEPOINT_STAGING_AWS_PROFILE ?? 'tracepoint-member-staging';
const identityClient = new CognitoIdentityProviderClient({ region });
const s3 = new S3Client({ region });
const createdUsernames = [];
const secrets = new Map();
let operationStage = 'startup';

function setOperationStage(stage) {
  operationStage = stage;
  console.log(JSON.stringify({ acceptanceStage: stage }));
}

function safeFailureCode(error) {
  const code = String(error?.code ?? '');
  if (/^[0-9A-Z]{5}$/.test(code)) return code;
  if (/^(ECONN|EAI_|ETIMEDOUT|ENOTFOUND)/.test(code)) return code;
  if (error?.name === 'AssertionError') return 'PRECONDITION_FAILED';
  return error?.name === 'AccessDeniedException' ? 'AWS_ACCESS_DENIED' : 'RUNNER_FAILURE';
}

function aws(args) {
  return JSON.parse(execFileSync('aws.exe', [...args, '--profile', process.env.AWS_PROFILE, '--region', region, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

async function retryTransientAws(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const code = error?.code ?? error?.name;
      if (!['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'TimeoutError', 'AbortError'].includes(code) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

function currentIdentity() {
  const identity = aws(['sts', 'get-caller-identity']);
  assert.equal(identity.Account, account, 'Only the staging account is allowed.');
  assert.match(identity.Arn, new RegExp(`^arn:aws:sts::${account}:assumed-role/[^/]*TracePointMigrationStaging[^/]*/`));
}

function verifyLiveBoundary() {
  currentIdentity();
  const service = aws(['ecs', 'describe-services', '--cluster', 'tracepoint-staging', '--services', 'tracepoint-staging']).services?.[0];
  assert.equal(service?.status, 'ACTIVE');
  assert.equal(service?.runningCount, service?.desiredCount);
  const task = aws(['ecs', 'describe-task-definition', '--task-definition', service.taskDefinition]).taskDefinition;
  const env = new Map(task.containerDefinitions[0].environment.map(entry => [entry.name, entry.value]));
  assert.equal(env.get('TRACEPOINT_AUTH_PROVIDER'), 'cognito');
  assert.equal(env.get('TRACEPOINT_RUNTIME_PROVIDER_MODE'), 'aws-native');
  assert.ok(task.containerDefinitions[0].secrets.some(entry => entry.name === 'CONFIGURATION_ENVIRONMENT'));
  const db = aws(['rds', 'describe-db-instances', '--db-instance-identifier', 'tracepoint-staging-full-aws']).DBInstances?.[0];
  assert.equal(db?.DBInstanceStatus, 'available');
  assert.equal(db?.PubliclyAccessible, false);
  assert.match(db?.Endpoint?.Address ?? '', /^tracepoint-staging-full-aws\./);
  return { service, task, appDigest: task.containerDefinitions[0].image.split('@').at(-1), databaseHost: db.Endpoint.Address };
}

async function verifyCognitoBoundary(expectedUsernames = [], requireTotp = true, allowOtherAcceptanceUsers = false) {
  const mfa = await identityClient.send(new GetUserPoolMfaConfigCommand({ UserPoolId: poolId }));
  if (mfa?.MfaConfiguration !== 'ON') throw Object.assign(new Error(), { code: 'STAGING_MFA_NOT_REQUIRED' });
  if (requireTotp && mfa?.SoftwareTokenMfaConfiguration?.Enabled !== true) throw Object.assign(new Error(), { code: 'STAGING_TOTP_FACTOR_UNAVAILABLE' });
  const app = (await identityClient.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: clientId }))).UserPoolClient;
  assert.equal(app?.AllowedOAuthFlowsUserPoolClient, true);
  assert.ok(app?.AllowedOAuthFlows?.includes('code'));
  assert.ok(app?.AllowedOAuthScopes?.includes('openid'));
  assert.ok(app?.CallbackURLs?.includes(callback));
  assert.ok(app?.ExplicitAuthFlows?.includes('ALLOW_USER_SRP_AUTH'));
  const domainInfo = aws(['cognito-idp', 'describe-user-pool-domain', '--domain', 'tracepoint-staging-559054714699']);
  assert.equal(domainInfo.DomainDescription?.Status, 'ACTIVE');
  const found = await listCognitoAcceptanceUsers();
  if (!allowOtherAcceptanceUsers) {
    assert.ok(found.every(user => expectedUsernames.includes(user.Username)), 'Only the saved fixture run may exist during cleanup.');
    if (!expectedUsernames.length) assert.equal(found.length, 0, 'No prior synthetic acceptance identities may exist.');
  }
}

async function listCognitoAcceptanceUsers() {
  const found = [];
  let paginationToken;
  do {
    const page = await retryTransientAws(() => identityClient.send(new ListUsersCommand({
      UserPoolId: poolId, Limit: 60, ...(paginationToken ? { PaginationToken: paginationToken } : {}),
    })));
    found.push(...(page.Users ?? []).filter(isStagingAcceptanceUser));
    paginationToken = page.PaginationToken;
  } while (paginationToken);
  return found;
}

function newManifest(run) {
  const agencies = [0, 1].map(index => ({ id: randomUUID(), slug: `acceptance-${run}-${index}` }));
  const roles = [
    { role: 'officer', agencyIndex: 0, code: 'officer' },
    { role: 'instructor', agencyIndex: 0, code: 'instructor' },
    { role: 'supervisor', agencyIndex: 0, code: 'supervisor' },
    { role: 'administrator', agencyIndex: 0, code: 'administrator' },
    { role: 'officer', agencyIndex: 1, code: 'foreign' },
  ];
  return { environment: 'staging', run, poolId, issuer, agencies, users: roles.map((spec, index) => ({
    id: randomUUID(), subject: '', username: '',
    email: `acceptance-${run}-${spec.code}@example.invalid`, fullName: `Staging Acceptance ${spec.role} ${index + 1}`,
    role: spec.role, agencyIndex: spec.agencyIndex,
  })) };
}

async function provisionCognito(manifest, passwords) {
  for (const user of manifest.users) {
    createdUsernames.push(user.email);
    const response = await identityClient.send(new AdminCreateUserCommand({
      UserPoolId: poolId, Username: user.email, MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'email', Value: user.email }, { Name: 'name', Value: user.fullName }, { Name: 'email_verified', Value: 'false' }],
      TemporaryPassword: passwords.get(user.email),
    }));
    const subject = response.User?.Attributes?.find(attribute => attribute.Name === 'sub')?.Value;
    const canonicalUsername = response.User?.Username;
    if (canonicalUsername) {
      user.subject = subject ?? '';
      user.username = canonicalUsername;
      createdUsernames.push(canonicalUsername);
    }
    assert.match(subject ?? '', /^[0-9a-f-]{36}$/i);
    assert.match(canonicalUsername ?? '', /^[0-9a-f-]{36}$/i);
    user.subject = subject;
    user.username = canonicalUsername;
    await identityClient.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: canonicalUsername, Password: passwords.get(user.email), Permanent: true }));
  }
}

function runFixtureTask(action, manifestPath, toolingCommit) {
  const powershell = process.env.TRACEPOINT_POWERSHELL ?? 'powershell.exe';
  const script = fileURLToPath(new URL('./apply-app-migrations.ps1', import.meta.url));
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Environment', 'staging', '-Action', action,
    '-ImageCommit', toolingCommit, '-AcceptanceFixtureManifestPath', manifestPath];
  const result = spawnSync(powershell, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error('Staging fixture task did not complete successfully.');
}

async function listFixtureStorage(manifest, target) {
  const listings = [];
  for (const agency of manifest.agencies) {
    const prefix = fixtureStoragePrefix(agency.id);
    listings.push({ prefix, ...(await s3.send(new ListObjectVersionsCommand({ ...target, Prefix: prefix }))) });
  }
  return listings;
}

// Deletes only the objects the run recorded creating, and only after the staging database confirms the agencies are
// this run's synthetic agencies and attests each object's upload. Any other object under the run's prefixes, or a
// failed ownership check, stops cleanup before anything is deleted.
async function cleanupStorage(manifest, manifestPath, toolingCommit) {
  currentIdentity();
  const target = { Bucket: 'tracepoint-staging-private-559054714699', ExpectedBucketOwner: account };
  const deletions = planFixtureStorageDeletion(manifest, await listFixtureStorage(manifest, target));
  if (!deletions.length) return;
  runFixtureTask('acceptance-fixture-verify', manifestPath, toolingCommit);
  for (const object of deletions) await s3.send(new DeleteObjectCommand({ ...target, ...object }));
  const remaining = await listFixtureStorage(manifest, target);
  if (remaining.some(listing => (listing.Versions?.length ?? 0) + (listing.DeleteMarkers?.length ?? 0) !== 0)) throw new Error('Staging fixture storage cleanup was incomplete.');
}

async function deleteCognitoUsers(manifest) {
  currentIdentity();
  const fixtureEmails = new Set((manifest?.users ?? []).map(user => user.email));
  const liveFixtureNames = (await listCognitoAcceptanceUsers()).filter(user => {
    const email = user.Attributes?.find(attribute => attribute.Name === 'email')?.Value;
    return fixtureEmails.has(email);
  }).map(user => user.Username);
  const usernames = new Set([...createdUsernames, ...liveFixtureNames].filter(username => /^[0-9a-f-]{36}$/i.test(username ?? '')));
  let failed = false;
  for (const username of [...usernames].reverse()) {
    try { await retryTransientAws(() => identityClient.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: username }))); }
    catch (error) { if (error?.name !== 'UserNotFoundException') failed = true; }
  }
  if (failed) throw new Error('One or more staging Cognito fixture identities could not be deleted.');
}

async function main() {
  if (process.argv.includes('--preflight')) {
    setOperationStage('verify-staging-task-and-rds');
    const boundary = verifyLiveBoundary();
    setOperationStage('verify-cognito-pool-and-client');
    await verifyCognitoBoundary();
    assert.match(boundary.appDigest ?? '', /^sha256:[0-9a-f]{64}$/);
    console.log(JSON.stringify({ stagingBoundary: 'verified', taskRevision: boundary.service.taskDefinition.split(':').at(-1), appDigest: boundary.appDigest, syntheticUsersPresent: false, mfa: 'required' }));
    return;
  }
  const recoveryIndex = process.argv.indexOf('--cleanup-manifest');
  if (recoveryIndex !== -1) {
    setOperationStage('recover-fixture-cleanup');
    // The manifest must be a run's own manifest in a fixture run directory, and describe exactly the agencies and
    // identities that run's ownership marker recorded, before any AWS call: storage, database and Cognito cleanup
    // all act on the ids it names.
    const opened = await openFixtureManifest(process.argv[recoveryIndex + 1]);
    const manifestPath = opened.manifestPath;
    const manifestInput = assertManifestMatchesMarker(JSON.parse(await readFile(manifestPath, 'utf8')), opened.marker);
    setOperationStage('verify-staging-account');
    currentIdentity();
    setOperationStage('resolve-canonical-cognito-usernames');
    const liveUsers = await listCognitoAcceptanceUsers();
    for (const user of manifestInput.users ?? []) {
      if (!/^[0-9a-f-]{36}$/i.test(user.username ?? '')) {
        const canonicalUsername = liveUsers.find(candidate => {
          const attributes = new Map((candidate.Attributes ?? []).map(attribute => [attribute.Name, attribute.Value]));
          return attributes.get('email') === user.email && attributes.get('sub') === user.subject;
        })?.Username;
        user.username = canonicalUsername ?? user.subject;
      }
    }
    const manifest = assertManifestMatchesMarker(validateStagingFixtureManifest(manifestInput, 'cleanup'), opened.marker);
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    setOperationStage('verify-cognito-cleanup-target');
    await verifyCognitoBoundary(manifest.users.map(user => user.username), false, true);
    for (const user of manifest.users ?? []) createdUsernames.push(user.username);
    setOperationStage('verify-staging-database-boundary');
    verifyLiveBoundary();
    const toolingCommit = execFileSync('git.exe', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
    setOperationStage('remove-staging-fixture-objects');
    await cleanupStorage(manifest, manifestPath, toolingCommit);
    setOperationStage('run-database-fixture-cleanup');
    runFixtureTask('acceptance-fixture-cleanup', manifestPath, toolingCommit);
    setOperationStage('remove-cognito-fixture-users');
    await deleteCognitoUsers(manifest);
    setOperationStage('verify-fixture-cleanup');
    console.log(JSON.stringify({ fixtureRun: manifest.run, cleanup: 'verified', secretsPersisted: false }));
    await removeRunDirectory(opened.directory, manifest.run);
    return;
  }
  if (!process.argv.includes('--execute')) throw new Error('Run with --execute to provision disposable staging identities and data.');
    setOperationStage('verify-staging-task-and-rds');
  const boundary = verifyLiveBoundary();
    setOperationStage('verify-cognito-pool-and-client');
  await verifyCognitoBoundary();
  const run = randomUUID();
  const manifest = newManifest(run);
  const passwords = new Map(manifest.users.map(user => [user.email, `Aa1!${randomBytes(36).toString('base64url')}Zz9!`]));
  const { directory: runDirectory, manifestPath } = await createFixtureRunDirectory(manifest);
  let taskAttempted = false;
  let resultCode = 1;
  let cleanupError = false;
  try {
    setOperationStage('create-synthetic-cognito-users');
    await provisionCognito(manifest, passwords);
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
    const toolingCommit = execFileSync('git.exe', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
    assert.match(toolingCommit, /^[0-9a-f]{40}$/);
    taskAttempted = true;
    setOperationStage('seed-staging-database-fixtures');
    runFixtureTask('acceptance-fixture-create', manifestPath, toolingCommit);
    setOperationStage('authenticated-pkce-mfa-acceptance');
    const acceptance = await runAuthenticatedAcceptance({ manifest, passwords, mfaSecrets: secrets, onStorageObject: async (key) => {
      // Recorded before anything else happens, so cleanup and recovery can delete exactly this object.
      const tracked = { ...manifest, storageObjects: [...(manifest.storageObjects ?? []), key] };
      validateStagingFixtureManifest(tracked, 'cleanup');
      manifest.storageObjects = tracked.storageObjects;
      await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    } });
    console.log(JSON.stringify({ stagingTarget: 'verified', taskRevision: boundary.service.taskDefinition.split(':').at(-1), appDigest: boundary.appDigest }));
    for (const item of acceptance.results) console.log(JSON.stringify(item));
    resultCode = acceptance.results.every(item => item.status === 'pass') ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ acceptanceHarness: 'failed', stage: operationStage, failureCode: safeFailureCode(error), sensitiveDetailsPrinted: false }));
  } finally {
    try {
      setOperationStage('cleanup-staging-fixtures');
      if (taskAttempted) {
        const toolingCommit = execFileSync('git.exe', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
        await cleanupStorage(manifest, manifestPath, toolingCommit);
        runFixtureTask('acceptance-fixture-cleanup', manifestPath, toolingCommit);
      }
    } catch { cleanupError = true; }
    try { await deleteCognitoUsers(manifest); } catch { cleanupError = true; }
    if (cleanupError) {
      console.error(JSON.stringify({ fixtureRun: run, cleanup: 'FAILED', recoveryManifest: manifestPath, secretsPersisted: false }));
      resultCode = 1;
    } else {
      console.log(JSON.stringify({ fixtureRun: run, cleanup: 'verified', secretsPersisted: false }));
      if (!await removeRunDirectory(runDirectory, run)) resultCode = 1;
    }
  }
  process.exitCode = resultCode;
}

/** Removes the run's fixture directory only if it verifies; otherwise leaves it in place and says so. */
async function removeRunDirectory(directory, run) {
  try {
    await removeFixtureRunDirectory(directory, run);
    return true;
  } catch (error) {
    console.error(JSON.stringify({ fixtureRun: run, fixtureDirectory: 'PRESERVED', path: directory, reason: error?.code === 'FIXTURE_DIRECTORY_REFUSED' ? error.message : 'removal failed' }));
    process.exitCode = 1;
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(JSON.stringify({ acceptanceHarness: 'failed', stage: operationStage, failureClass: error?.code ?? (error?.name === 'AssertionError' ? 'PRECONDITION_FAILED' : error?.name === 'AccessDeniedException' ? 'AWS_ACCESS_DENIED' : 'RUNNER_FAILURE'), sensitiveDetailsPrinted: false })); process.exitCode = 1; });
}
