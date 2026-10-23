import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The staging acceptance run keeps its recovery manifest on disk. Cleanup used to remove the manifest's
// parent directory recursively, so a recovery manifest kept anywhere else (an evidence folder, the
// repository) took that whole folder with it. Fixture files now live only in run directories under one
// dedicated root, each carrying an ownership marker for its run, and are removed file by file, never
// recursively. Anything that does not match exactly is refused and left in place for inspection.

export const FIXTURE_ROOT_NAME = 'tracepoint-staging-acceptance-fixtures';
export const FIXTURE_MARKER = '.tracepoint-acceptance-fixture.json';
const OWNER = 'tracepoint-staging-acceptance';
const RUN_DIRECTORY = /^run-[A-Za-z0-9]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export class FixtureDirectoryRefused extends Error {
  constructor(reason) {
    super(`Fixture directory refused: ${reason}.`);
    this.name = 'FixtureDirectoryRefused';
    this.code = 'FIXTURE_DIRECTORY_REFUSED';
  }
}
const refuse = (reason) => { throw new FixtureDirectoryRefused(reason); };
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
async function canonical(target) { try { return await realpath(target); } catch { return path.resolve(target); } }

/**
 * The dedicated fixture root (TRACEPOINT_ACCEPTANCE_FIXTURE_ROOT, default <tmpdir>/tracepoint-staging-acceptance-fixtures):
 * absolute, named for the fixture, not a link, and never a filesystem root, the repository, the home directory or an
 * ancestor of either. Returns its canonical path.
 */
export async function fixtureRoot(environment = process.env, { create = true } = {}) {
  const configured = environment.TRACEPOINT_ACCEPTANCE_FIXTURE_ROOT || path.join(tmpdir(), FIXTURE_ROOT_NAME);
  if (!path.isAbsolute(configured)) refuse('the fixture root must be an absolute path');
  const root = path.resolve(configured);
  if (path.parse(root).root === root) refuse('the fixture root cannot be a filesystem root');
  if (path.basename(root) !== FIXTURE_ROOT_NAME) refuse(`the fixture root must be a directory named ${FIXTURE_ROOT_NAME}`);
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  let stat;
  try { stat = await lstat(root); } catch { refuse('the fixture root does not exist'); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) refuse('the fixture root must be a real directory, not a link');
  const real = await realpath(root);
  for (const protectedPath of [repositoryRoot, homedir()]) {
    if (contains(real, await canonical(protectedPath))) refuse('the fixture root contains the repository or the home directory');
  }
  return real;
}

/** Creates this run's directory with its ownership marker; the manifest is written beside it. */
export async function createFixtureRunDirectory(manifest, environment = process.env) {
  if (!UUID.test(String(manifest?.run))) refuse('the fixture run identifier is invalid');
  const root = await fixtureRoot(environment);
  const directory = await mkdtemp(path.join(root, 'run-'));
  const marker = {
    owner: OWNER, run: manifest.run,
    agencies: (manifest.agencies ?? []).map((agency) => ({ id: agency.id, slug: agency.slug })),
    users: (manifest.users ?? []).map((user) => user.email),
  };
  await writeFile(path.join(directory, FIXTURE_MARKER), JSON.stringify(marker), { mode: 0o600, flag: 'wx' });
  return { directory, manifestPath: path.join(directory, `${manifest.run}.json`) };
}

/**
 * A run directory is a direct child of the fixture root, named run-XXXXXX, not a link, reached by its canonical
 * path, holding only regular files: its ownership marker and, optionally, its own manifest. Returns the marker.
 */
async function verifiedRunDirectory(root, directory) {
  const resolved = path.resolve(directory);
  if (!samePath(path.dirname(resolved), root)) refuse('the directory is not a run directory of the fixture root');
  const name = path.basename(resolved);
  if (!RUN_DIRECTORY.test(name)) refuse('the directory is not named as a fixture run directory');
  let stat;
  try { stat = await lstat(resolved); } catch { refuse('the run directory does not exist'); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) refuse('the run directory must be a real directory, not a link');
  if (!samePath(await realpath(resolved), path.join(root, name))) refuse('the run directory is reached through a link');
  let marker;
  try { marker = JSON.parse(await readFile(path.join(resolved, FIXTURE_MARKER), 'utf8')); } catch { refuse('the run directory has no readable ownership marker'); }
  if (marker?.owner !== OWNER || !UUID.test(String(marker?.run))) refuse('the ownership marker is not a fixture marker');
  const allowed = new Set([FIXTURE_MARKER, `${marker.run}.json`]);
  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    if (!allowed.has(entry.name)) refuse('the run directory holds an unexpected entry');
    if (!entry.isFile()) refuse('the run directory holds a link or a directory');
  }
  return { directory: path.join(root, name), marker };
}

/**
 * Recovery: the manifest path must be the run's own manifest inside a verified run directory. Returns the
 * canonical directory and manifest path and the marker, before anything else is read or changed.
 */
export async function openFixtureManifest(manifestPath, environment = process.env) {
  if (typeof manifestPath !== 'string' || !manifestPath.trim()) refuse('a manifest path is required');
  const root = await fixtureRoot(environment, { create: false });
  const resolved = path.resolve(manifestPath);
  const { directory, marker } = await verifiedRunDirectory(root, path.dirname(resolved));
  if (path.basename(resolved) !== `${marker.run}.json`) refuse('the manifest is not this run\'s manifest');
  const stat = await lstat(path.join(directory, `${marker.run}.json`)).catch(() => null);
  if (!stat?.isFile()) refuse('the run\'s manifest is missing or not a regular file');
  return { directory, manifestPath: path.join(directory, `${marker.run}.json`), marker };
}

/** The manifest must describe exactly the agencies and identities the marker recorded when the run was created. */
export function assertManifestMatchesMarker(manifest, marker) {
  const agencies = (list) => JSON.stringify((list ?? []).map((agency) => [agency.id, agency.slug]).sort());
  const users = (list) => JSON.stringify([...(list ?? [])].sort());
  if (manifest?.run !== marker?.run) refuse('the manifest run does not match the ownership marker');
  if (agencies(manifest.agencies) !== agencies(marker.agencies)) refuse('the manifest agencies do not match the ownership marker');
  if (users((manifest.users ?? []).map((user) => user.email)) !== users(marker.users)) refuse('the manifest identities do not match the ownership marker');
  return manifest;
}

/** Removes a verified run directory file by file and then the empty directory; never recursive. */
export async function removeFixtureRunDirectory(directory, run, environment = process.env) {
  const root = await fixtureRoot(environment, { create: false });
  const verified = await verifiedRunDirectory(root, directory);
  if (verified.marker.run !== run) refuse('the ownership marker belongs to another run');
  const manifest = path.join(verified.directory, `${run}.json`);
  if (await lstat(manifest).then((stat) => stat.isFile(), () => false)) await unlink(manifest);
  await unlink(path.join(verified.directory, FIXTURE_MARKER));
  await rmdir(verified.directory);
}
