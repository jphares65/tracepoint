import { fixtureStorageObjects } from './staging-cognito-fixture-core.mjs';

// Storage cleanup used to delete every version under department-assets/<agency id>/ for each agency id the manifest
// named. It now deletes only the exact objects the run recorded creating, and only when nothing else is stored under
// the run's agency prefixes: any untracked object, a truncated listing or a key outside its prefix refuses the whole
// cleanup before anything is deleted. The runner also has the staging database verify ownership before deleting.

export class FixtureStorageRefused extends Error {
  constructor(reason) {
    super(`Fixture storage cleanup refused: ${reason}.`);
    this.name = 'FixtureStorageRefused';
    this.code = 'FIXTURE_STORAGE_REFUSED';
  }
}
const refuse = (reason) => { throw new FixtureStorageRefused(reason); };

export const fixtureStoragePrefix = (agencyId) => `department-assets/${agencyId}/`;

/**
 * Given one ListObjectVersions listing per fixture agency ({ prefix, IsTruncated, Versions, DeleteMarkers }), returns
 * the exact { Key, VersionId } pairs to delete: every version and delete marker of each tracked object, nothing else.
 */
export function planFixtureStorageDeletion(manifest, listings) {
  const tracked = new Set(fixtureStorageObjects(manifest).map(object => object.key));
  const prefixes = new Set((manifest.agencies ?? []).map(agency => fixtureStoragePrefix(agency.id)));
  const seen = new Set();
  const deletions = [];
  for (const listing of listings) {
    if (!prefixes.has(listing?.prefix) || seen.has(listing.prefix)) refuse('a listing is not one of this run\'s agency prefixes');
    seen.add(listing.prefix);
    if (listing.IsTruncated) refuse('an agency prefix holds more than one page of objects');
    for (const object of [...(listing.Versions ?? []), ...(listing.DeleteMarkers ?? [])]) {
      if (typeof object?.Key !== 'string' || !object.Key.startsWith(listing.prefix)) refuse('a listed object is outside its agency prefix');
      if (!tracked.has(object.Key)) refuse('an agency prefix holds an object this run did not record creating');
      if (!object.VersionId) refuse('a listed object has no version identifier');
      deletions.push({ Key: object.Key, VersionId: object.VersionId });
    }
  }
  if (seen.size !== prefixes.size) refuse('an agency prefix was not listed');
  return deletions;
}

/**
 * Performs one idempotent cleanup pass over only the manifest's recorded keys and their listed versions.
 * The caller supplies retry-wrapped AWS operations; ownership is checked after a first plan is built, and the
 * deletion set is planned again from a fresh listing before the first version is deleted. A later recovery pass replans from the current listing, so already deleted
 * versions are not reintroduced and the manifest cannot expand the deletion scope.
 */
export async function cleanupRecordedFixtureStorage(manifest, target, {
  listVersions,
  verifyOwnership,
  deleteVersion,
  retry = operation => operation(),
}) {
  if (typeof listVersions !== 'function' || typeof verifyOwnership !== 'function' || typeof deleteVersion !== 'function' || typeof retry !== 'function') {
    throw new TypeError('Fixture storage cleanup operations are required.');
  }
  const listAll = async () => {
    const listings = [];
    for (const agency of manifest.agencies) {
      const prefix = fixtureStoragePrefix(agency.id);
      listings.push({ prefix, ...(await retry(() => listVersions({ ...target, Prefix: prefix }))) });
    }
    return listings;
  };

  if (!planFixtureStorageDeletion(manifest, await listAll()).length) return { planned: 0, deleted: 0 };
  await verifyOwnership();
  // The ownership check takes minutes; what is deleted is planned again from a listing taken after it, under the
  // same rules, so a version added, removed or left untracked meanwhile is accounted for before anything is deleted.
  const deletions = planFixtureStorageDeletion(manifest, await listAll());
  for (const object of deletions) {
    try {
      await retry(() => deleteVersion({ ...target, Key: object.Key, VersionId: object.VersionId }));
    } catch (error) {
      // S3 may have deleted the version even though the response was lost. Only a fresh listing showing that exact
      // key and version gone counts it as deleted; anything else, including a failed or mismatched listing, keeps the error.
      const listing = await retry(() => listVersions({ ...target, Prefix: object.Key })).catch(() => undefined);
      const stillPresent = !listing || listing.Prefix !== object.Key || listing.IsTruncated || [...(listing.Versions ?? []), ...(listing.DeleteMarkers ?? [])]
        .some(candidate => candidate?.Key === object.Key && candidate?.VersionId === object.VersionId);
      if (stillPresent) throw error;
    }
  }
  const remaining = await listAll();
  if (remaining.some(listing => listing.IsTruncated || (listing.Versions?.length ?? 0) + (listing.DeleteMarkers?.length ?? 0) !== 0)) {
    const error = new Error('Staging fixture storage cleanup was incomplete.');
    error.code = 'FIXTURE_STORAGE_INCOMPLETE';
    throw error;
  }
  return { planned: deletions.length, deleted: deletions.length };
}
