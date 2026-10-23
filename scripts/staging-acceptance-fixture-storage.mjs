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
 * The fixture task's last failure line (for example "Migration task failed (stop code TaskFailedToStart; ...)"), with
 * addresses, long tokens and quoted values removed, or null. The runner prints only this, never the task's output.
 */
export function fixtureTaskFailureLine(output) {
  const lines = String(output ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const line = lines.reverse().find(candidate => /failed|refused|not (?:found|available|confirmed)|exception|error/i.test(candidate) && !/^\s*(?:at |\+ |~|CategoryInfo|FullyQualifiedErrorId)/.test(candidate));
  if (!line) return null;
  return line
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}|(?![0-9a-f]{48,}\b)[A-Za-z0-9+/_-]{48,}={0,2})/g, '[redacted-token]')
    .replace(/'[^']*'|"[^"]*"/g, '[redacted]')
    .slice(0, 400);
}

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
