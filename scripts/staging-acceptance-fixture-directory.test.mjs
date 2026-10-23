import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_MARKER, FIXTURE_ROOT_NAME, assertManifestMatchesMarker, createFixtureRunDirectory, fixtureRoot,
  openFixtureManifest, removeFixtureRunDirectory,
} from './staging-acceptance-fixture-directory.mjs';

// The acceptance runner's cleanup removed path.dirname(manifestPath) recursively, so recovery with a manifest kept
// in any other folder deleted that folder. Every case below must either remove exactly the run's own fixture files
// or refuse and leave everything in place.
const run = 'c30a4084-6487-4c42-9d6f-83fd1df935a8';
const otherRun = '7d1e2f3a-0000-4000-8000-000000000001';
const manifest = {
  environment: 'staging', run,
  agencies: [0, 1].map((index) => ({ id: `00000000-0000-4000-8000-00000000000${index + 1}`, slug: `acceptance-${run}-${index}` })),
  users: ['officer', 'foreign'].map((role) => ({ email: `acceptance-${run}-${role}@example.invalid` })),
};
const refused = { code: 'FIXTURE_DIRECTORY_REFUSED' };
let sandbox, root, environment, evidence;

before(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'fixture-directory-guard-'));
  root = path.join(sandbox, FIXTURE_ROOT_NAME);
  environment = { TRACEPOINT_ACCEPTANCE_FIXTURE_ROOT: root };
  // Stands in for an operator's evidence folder that must never be touched.
  evidence = path.join(sandbox, 'TracePointEvidence');
  await mkdir(evidence);
  await writeFile(path.join(evidence, 'keep.txt'), 'evidence');
});
after(async () => { if (sandbox) await rm(sandbox, { recursive: true, force: true }); });

const exists = (target) => stat(target).then(() => true, () => false);
async function newRun(input = manifest) {
  const created = await createFixtureRunDirectory(input, environment);
  await writeFile(created.manifestPath, JSON.stringify(input), { mode: 0o600 });
  return created;
}
async function evidenceIntact() {
  assert.deepEqual(await readdir(evidence), ['keep.txt']);
  assert.equal(await readFile(path.join(evidence, 'keep.txt'), 'utf8'), 'evidence');
}
/** Creates a link, or skips the test where this account may not create one (file symlinks on Windows). */
async function linkOrSkip(t, target, linkPath, type) {
  try { await symlink(target, linkPath, type); return true; }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('this account cannot create symbolic links'); return false; } throw error; }
}

test('a valid run: recovery opens its manifest, then only its two files and its own directory are removed', async () => {
  const { directory, manifestPath } = await newRun();
  await writeFile(path.join(root, 'unrelated.txt'), 'other file in the root');
  const opened = await openFixtureManifest(manifestPath, environment);
  assert.equal(opened.marker.run, run);
  assert.equal(assertManifestMatchesMarker(JSON.parse(await readFile(opened.manifestPath, 'utf8')), opened.marker).run, run);
  await removeFixtureRunDirectory(opened.directory, run, environment);
  assert.equal(await exists(directory), false);
  assert.equal(await exists(path.join(root, 'unrelated.txt')), true, 'nothing else in the root is touched');
  await evidenceIntact();
});

test('a run stopped before its manifest was written is still removed (marker only)', async () => {
  const { directory } = await createFixtureRunDirectory(manifest, environment);
  await removeFixtureRunDirectory(directory, run, environment);
  assert.equal(await exists(directory), false);
});

test('path traversal: a manifest path or directory that leaves the run directory is refused', async () => {
  const { directory, manifestPath } = await newRun();
  for (const target of [
    path.join(directory, '..', '..', 'TracePointEvidence', `${run}.json`),
    path.join(directory, '..', `${run}.json`),
    `${directory}${path.sep}..${path.sep}${path.basename(directory)}${path.sep}..${path.sep}..${path.sep}TracePointEvidence${path.sep}${run}.json`,
  ]) await assert.rejects(openFixtureManifest(target, environment), refused, target);
  for (const target of [path.join(directory, '..'), path.join(directory, '..', '..'), root, sandbox, evidence]) {
    await assert.rejects(removeFixtureRunDirectory(target, run, environment), refused, target);
  }
  assert.equal(await exists(manifestPath), true, 'the run is preserved');
  await evidenceIntact();
});

test('malicious manifest paths: an evidence folder, the repository, a filesystem root, relative and empty paths are refused', async () => {
  // The reported failure: a recovery manifest kept in an evidence folder, with a forged marker beside it.
  await writeFile(path.join(evidence, `${run}.json`), JSON.stringify(manifest));
  await writeFile(path.join(evidence, FIXTURE_MARKER), JSON.stringify({ owner: 'tracepoint-staging-acceptance', run, agencies: manifest.agencies, users: manifest.users.map((user) => user.email) }));
  const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  for (const target of [path.join(evidence, `${run}.json`), path.join(repository, `${run}.json`), path.join(path.parse(sandbox).root, `${run}.json`), `${run}.json`, '', '   ', undefined]) {
    await assert.rejects(openFixtureManifest(target, environment), refused, String(target));
  }
  for (const target of [evidence, repository, path.parse(sandbox).root]) {
    await assert.rejects(removeFixtureRunDirectory(target, run, environment), refused, target);
  }
  await rm(path.join(evidence, `${run}.json`)); await rm(path.join(evidence, FIXTURE_MARKER));
  await evidenceIntact();
  assert.equal(await exists(path.join(repository, 'package.json')), true);
});

test('links: a run-named link to another folder and a linked fixture root are refused', async (t) => {
  // A run-named junction/symlink inside the root pointing at the evidence folder.
  const linked = path.join(root, 'run-linked');
  if (!await linkOrSkip(t, evidence, linked, 'junction')) return;
  await writeFile(path.join(evidence, FIXTURE_MARKER), JSON.stringify({ owner: 'tracepoint-staging-acceptance', run, agencies: [], users: [] }));
  await assert.rejects(removeFixtureRunDirectory(linked, run, environment), refused);
  await assert.rejects(openFixtureManifest(path.join(linked, `${run}.json`), environment), refused);
  await rm(path.join(evidence, FIXTURE_MARKER));
  await evidenceIntact();
  await rm(linked);

  // The fixture root itself reached through a link.
  const linkedRootParent = await mkdtemp(path.join(sandbox, 'linked-root-'));
  const linkedRoot = path.join(linkedRootParent, FIXTURE_ROOT_NAME);
  await symlink(root, linkedRoot, 'junction');
  await assert.rejects(fixtureRoot({ TRACEPOINT_ACCEPTANCE_FIXTURE_ROOT: linkedRoot }), refused);
});

test('links: a manifest that is a symbolic link to a file elsewhere is refused', async (t) => {
  const { directory, manifestPath } = await createFixtureRunDirectory(manifest, environment);
  if (!await linkOrSkip(t, path.join(evidence, 'keep.txt'), manifestPath, 'file')) return;
  await assert.rejects(openFixtureManifest(manifestPath, environment), refused);
  await assert.rejects(removeFixtureRunDirectory(directory, run, environment), refused);
  await evidenceIntact();
});

test('missing or foreign ownership markers are refused and the files preserved', async () => {
  const bare = path.join(root, 'run-nomark');
  await mkdir(bare);
  await writeFile(path.join(bare, `${run}.json`), JSON.stringify(manifest));
  await assert.rejects(openFixtureManifest(path.join(bare, `${run}.json`), environment), refused);
  await assert.rejects(removeFixtureRunDirectory(bare, run, environment), refused);
  await writeFile(path.join(bare, FIXTURE_MARKER), JSON.stringify({ owner: 'someone-else', run }));
  await assert.rejects(removeFixtureRunDirectory(bare, run, environment), refused, 'wrong owner');
  await writeFile(path.join(bare, FIXTURE_MARKER), '{not json');
  await assert.rejects(removeFixtureRunDirectory(bare, run, environment), refused, 'unreadable marker');
  assert.deepEqual((await readdir(bare)).sort(), [FIXTURE_MARKER, `${run}.json`].sort());

  const { directory } = await newRun();
  await assert.rejects(removeFixtureRunDirectory(directory, otherRun, environment), refused, 'marker belongs to another run');
  await assert.rejects(openFixtureManifest(path.join(directory, `${otherRun}.json`), environment), refused, 'another run\'s manifest name');
  assert.equal(await exists(directory), true);
});

test('unexpected directory structure is refused: extra files, subdirectories, misnamed directories and roots', async () => {
  const { directory } = await newRun();
  await writeFile(path.join(directory, 'notes.txt'), 'operator notes');
  await assert.rejects(removeFixtureRunDirectory(directory, run, environment), refused, 'extra file');
  await rm(path.join(directory, 'notes.txt'));
  await mkdir(path.join(directory, 'nested'));
  await assert.rejects(removeFixtureRunDirectory(directory, run, environment), refused, 'subdirectory');
  assert.equal(await exists(path.join(directory, 'nested')), true);

  const misnamed = path.join(root, 'tracepoint-staging-acceptance-old');
  await mkdir(misnamed);
  await writeFile(path.join(misnamed, FIXTURE_MARKER), JSON.stringify({ owner: 'tracepoint-staging-acceptance', run }));
  await assert.rejects(removeFixtureRunDirectory(misnamed, run, environment), refused, 'not run-XXXXXX');
  const deeper = path.join(root, 'run-abcdef', 'run-ghijkl');
  await mkdir(deeper, { recursive: true });
  await writeFile(path.join(deeper, FIXTURE_MARKER), JSON.stringify({ owner: 'tracepoint-staging-acceptance', run }));
  await assert.rejects(removeFixtureRunDirectory(deeper, run, environment), refused, 'not a direct child of the root');

  for (const configured of [path.join(sandbox, 'fixtures'), 'relative/' + FIXTURE_ROOT_NAME, path.parse(sandbox).root, sandbox]) {
    await assert.rejects(fixtureRoot({ TRACEPOINT_ACCEPTANCE_FIXTURE_ROOT: configured }), refused, configured);
  }
  await evidenceIntact();
});

test('recovery refuses a manifest whose agencies or identities differ from what its run recorded', async () => {
  const { manifestPath } = await newRun();
  const opened = await openFixtureManifest(manifestPath, environment);
  const realAgency = { ...manifest, agencies: [{ id: '90000000-0000-4000-8000-000000000000', slug: manifest.agencies[0].slug }, manifest.agencies[1]] };
  assert.throws(() => assertManifestMatchesMarker(realAgency, opened.marker), refused, 'an agency id the run never created');
  assert.throws(() => assertManifestMatchesMarker({ ...manifest, users: [...manifest.users, { email: 'chief@agency.example' }] }, opened.marker), refused);
  assert.throws(() => assertManifestMatchesMarker({ ...manifest, run: otherRun }, opened.marker), refused);
});

test('the runner removes fixture files only through the guard; recovery refuses an outside manifest before any AWS call', async () => {
  const runner = await readFile(new URL('./run-staging-cognito-acceptance.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runner, /\brm\(|rmSync|recursive\s*:/, 'no recursive removal in the runner');
  assert.match(runner, /const opened = await openFixtureManifest\(process\.argv\[recoveryIndex \+ 1\]\);/);
  assert.ok(runner.indexOf('openFixtureManifest(') < runner.indexOf("setOperationStage('verify-staging-account')"), 'the manifest is verified before the AWS identity check');

  // Recovery pointed at a manifest in an evidence folder, with no usable AWS configuration at all: it must stop at the
  // guard (an AWS call could not succeed here either way) and leave the folder alone.
  const { spawnSync } = await import('node:child_process');
  await writeFile(path.join(evidence, `${run}.json`), JSON.stringify(manifest));
  const empty = path.join(sandbox, 'empty-aws-config');
  await writeFile(empty, '');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-staging-cognito-acceptance.mjs', import.meta.url)), '--cleanup-manifest', path.join(evidence, `${run}.json`)], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, ...environment, AWS_PROFILE: 'tracepoint-fixture-guard-test-none', TRACEPOINT_STAGING_AWS_PROFILE: 'tracepoint-fixture-guard-test-none', AWS_CONFIG_FILE: empty, AWS_SHARED_CREDENTIALS_FILE: empty, AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_SESSION_TOKEN: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /"stage":"recover-fixture-cleanup"/, 'it stopped at the first recovery stage');
  assert.match(result.stderr, /FIXTURE_DIRECTORY_REFUSED/);
  assert.equal(await readFile(path.join(evidence, `${run}.json`), 'utf8'), JSON.stringify(manifest), 'the manifest is not rewritten');
  await rm(path.join(evidence, `${run}.json`));
  await evidenceIntact();
});
